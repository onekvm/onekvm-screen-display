//! Local initialization checks. Never depend on Core or collect a diagnostic archive.
use serde_json::json;
use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    net::{SocketAddr, TcpStream},
    os::unix::fs::OpenOptionsExt,
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use zbus::blocking::{Connection, Proxy};

#[derive(Clone, Debug, Default)]
pub struct Snapshot {
    pub code: &'static str,
    pub stage: String,
    pub exit_status: i32,
}
impl Snapshot {
    pub fn state(&self) -> &'static str {
        match self.code {
            "" => "ready",
            "core-starting" | "persistence-starting" => "starting",
            _ => "error",
        }
    }
    fn json(&self) -> String {
        json!({"state":self.state(),"code":self.code,"stage":self.stage,"exit_status":self.exit_status}).to_string()
    }
}

pub struct Health {
    dirty: AtomicBool,
    busy: AtomicBool,
    snapshot: Mutex<String>,
}
impl Default for Health {
    fn default() -> Self {
        Self {
            dirty: AtomicBool::new(true),
            busy: AtomicBool::new(false),
            snapshot: Mutex::new(json!({"state":"checking","code":""}).to_string()),
        }
    }
}
impl Health {
    pub fn invalidate(&self) {
        self.dirty.store(true, Ordering::Release);
    }
    pub fn begin(&self) -> bool {
        if self.busy.swap(true, Ordering::AcqRel) {
            return false;
        }
        if !self.dirty.swap(false, Ordering::AcqRel) {
            self.busy.store(false, Ordering::Release);
            return false;
        }
        *self.snapshot.lock().unwrap() = json!({"state":"checking","code":""}).to_string();
        true
    }
    pub fn finish(&self, value: Snapshot) {
        if !value.code.is_empty() {
            log::warn!(
                "initialization check: {} stage={} status={}",
                value.code,
                value.stage,
                value.exit_status
            );
        }
        *self.snapshot.lock().unwrap() = value.json();
        self.busy.store(false, Ordering::Release);
    }
    pub fn snapshot(&self) -> String {
        self.snapshot.lock().unwrap().clone()
    }
}

#[derive(Default, Debug)]
struct Unit {
    active: String,
    result: String,
    status: i32,
    condition: bool,
    pending: bool,
}
fn unit(conn: &Connection, name: &str) -> Result<Unit, zbus::Error> {
    let manager = Proxy::new(
        conn,
        "org.freedesktop.systemd1",
        "/org/freedesktop/systemd1",
        "org.freedesktop.systemd1.Manager",
    )?;
    let path: zbus::zvariant::OwnedObjectPath = manager.call("GetUnit", &(name,))?;
    let properties = Proxy::new(
        conn,
        "org.freedesktop.systemd1",
        path.as_str(),
        "org.freedesktop.systemd1.Unit",
    )?;
    let service = Proxy::new(
        conn,
        "org.freedesktop.systemd1",
        path.as_str(),
        "org.freedesktop.systemd1.Service",
    )?;
    let job: (u32, zbus::zvariant::OwnedObjectPath) = properties.get_property("Job")?;
    Ok(Unit {
        active: properties.get_property("ActiveState")?,
        result: service.get_property("Result")?,
        status: service.get_property("ExecMainStatus")?,
        condition: properties.get_property("ConditionResult")?,
        pending: job.0 != 0,
    })
}
fn issue(code: &'static str) -> Snapshot {
    Snapshot {
        code,
        ..Snapshot::default()
    }
}

pub fn io_code(error: &io::Error) -> &'static str {
    match error.raw_os_error() {
        Some(libc::EROFS) => "storage-read-only",
        Some(libc::ENOSPC) | Some(libc::EDQUOT) => "storage-full",
        Some(libc::EIO) | Some(libc::ENODEV) | Some(libc::ENXIO) | Some(libc::ETIMEDOUT) => {
            "storage-io"
        }
        Some(libc::EACCES) | Some(libc::EPERM) => "storage-permission",
        _ => "storage-write",
    }
}
fn mount_read_only(raw: &str, path: &str) -> Option<bool> {
    raw.lines()
        .filter_map(|line| {
            let fields: Vec<_> = line.split_whitespace().collect();
            (fields.len() > 6 && fields[4] == path)
                .then(|| fields[5].split(',').any(|option| option == "ro"))
        })
        .last()
}
fn available(path: &Path) -> io::Result<bool> {
    let name = std::ffi::CString::new(path.as_os_str().as_encoded_bytes())?;
    let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statvfs(name.as_ptr(), &mut stat) } != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(
        u64::from(stat.f_bavail).saturating_mul(u64::from(stat.f_frsize)) >= 65536
            && (stat.f_files == 0 || stat.f_favail > 0),
    )
}
fn writable(path: &Path) -> io::Result<()> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let probe = path.join(format!(
        ".onekvm-setup-check-{}-{stamp}",
        std::process::id()
    ));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(&probe)?;
    let result = file
        .write_all(b"OneKVM setup storage check\n")
        .and_then(|_| file.sync_all());
    drop(file);
    let cleanup = fs::remove_file(&probe);
    result.and(cleanup)
}
fn persistence_code(stage: &str) -> &'static str {
    match stage {
        "boot-slot" => "boot-slot",
        "package-keys" | "build-id" | "image-files" => "system-files",
        _ => "persistence-failed",
    }
}
fn unit_issue(persistence: &Unit, core: &Unit, status: &str, nfs: bool) -> Option<Snapshot> {
    if persistence.active == "failed"
        || (persistence.active == "inactive" && persistence.result != "success")
    {
        let stage = status
            .lines()
            .find_map(|line| line.strip_prefix("stage="))
            .unwrap_or_default();
        return Some(Snapshot {
            code: persistence_code(stage),
            stage: stage.into(),
            exit_status: persistence.status,
        });
    }
    // A unit waiting for firstboot or another ordered dependency is still
    // inactive. Its queued start job distinguishes it from a skipped/stopped unit.
    if persistence.active == "inactive" && persistence.pending {
        return Some(issue("persistence-starting"));
    }
    if !nfs && persistence.active == "inactive" && !persistence.condition {
        return Some(issue("persistence-skipped"));
    }
    if persistence.active == "activating" {
        return Some(issue("persistence-starting"));
    }
    if core.active == "activating" || (core.active == "inactive" && core.pending) {
        return Some(issue("core-starting"));
    }
    if core.active != "active" && core.active != "reloading" {
        return Some(Snapshot {
            code: if core.status == 203 {
                "system-files"
            } else {
                "core-failed"
            },
            stage: String::new(),
            exit_status: core.status,
        });
    }
    None
}

/// Called on entry, relevant systemd events, explicit Retry and before saving an account.
/// One short fsync probe per request; no frame-time IO, Internet checks or log collection.
pub fn inspect() -> Snapshot {
    let cmdline = match fs::read_to_string("/proc/cmdline") {
        Ok(value) => value,
        Err(_) => return issue("status-unavailable"),
    };
    let nfs = crate::setup::nfs_root_cmdline(&cmdline);
    if !nfs
        && !cmdline
            .split_whitespace()
            .any(|arg| matches!(arg, "rauc.slot=A" | "rauc.slot=B"))
    {
        return issue("boot-slot");
    }
    if !nfs {
        let mounts = match fs::read_to_string("/proc/self/mountinfo") {
            Ok(value) => value,
            Err(_) => return issue("status-unavailable"),
        };
        match mount_read_only(&mounts, "/mnt/storage") {
            None => return issue("storage-unmounted"),
            Some(true) => return issue("storage-read-only"),
            Some(false) => {}
        }
    }
    for path in [Path::new("/mnt/storage"), Path::new("/etc/onekvm")] {
        match available(path) {
            Ok(false) => return issue("storage-full"),
            Err(err) => return issue(io_code(&err)),
            Ok(true) => {}
        }
        if let Err(err) = writable(path) {
            log::warn!("initialization storage check {}: {err}", path.display());
            return issue(io_code(&err));
        }
    }
    let config: serde_json::Value = match fs::read("/etc/onekvm/config.json") {
        Ok(raw) => match serde_json::from_slice::<serde_json::Value>(&raw) {
            Ok(value) if value.is_object() => value,
            _ => return issue("config-invalid"),
        },
        Err(err) if err.kind() == io::ErrorKind::NotFound => json!({}),
        Err(err) => return issue(io_code(&err)),
    };
    for required in [
        "/usr/share/onekvm/build-id",
        "/usr/share/onekvm/opkg-baseline/status",
        "/etc/opkg/gpg/pubring.kbx",
        "/etc/opkg/gpg/trustdb.gpg",
    ] {
        match fs::metadata(required) {
            Ok(meta) if meta.is_file() && meta.len() > 0 => {}
            Err(err)
                if matches!(
                    err.raw_os_error(),
                    Some(libc::EIO | libc::ENODEV | libc::ETIMEDOUT)
                ) =>
            {
                return issue("storage-io")
            }
            _ => {
                log::warn!("required initialization file missing or unreadable: {required}");
                return issue("system-files");
            }
        }
    }
    let conn = match zbus::blocking::connection::Builder::system()
        .and_then(|builder| builder.method_timeout(Duration::from_secs(1)).build())
    {
        Ok(conn) => conn,
        Err(_) => return issue("status-unavailable"),
    };
    let persistence = match unit(&conn, "onekvm-persistence.service") {
        Ok(unit) => unit,
        Err(_) => return issue("status-unavailable"),
    };
    let core = match unit(&conn, "onekvm.service") {
        Ok(unit) => unit,
        Err(_) => return issue("status-unavailable"),
    };
    let progress = fs::read_to_string("/run/onekvm/persistence-status").unwrap_or_default();
    if let Some(problem) = unit_issue(&persistence, &core, &progress, nfs) {
        return problem;
    }
    let port = crate::setup::configured_api_port(&config, "http");
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    if TcpStream::connect_timeout(&address, Duration::from_millis(750)).is_err() {
        return issue("core-unreachable");
    }
    Snapshot::default()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn storage_errno_is_evidence_not_a_guess_about_card_health() {
        for (errno, code) in [
            (libc::EROFS, "storage-read-only"),
            (libc::ENOSPC, "storage-full"),
            (libc::EDQUOT, "storage-full"),
            (libc::EIO, "storage-io"),
            (libc::ENODEV, "storage-io"),
            (libc::ETIMEDOUT, "storage-io"),
            (libc::EACCES, "storage-permission"),
            (libc::EINVAL, "storage-write"),
        ] {
            assert_eq!(io_code(&io::Error::from_raw_os_error(errno)), code);
        }
    }
    #[test]
    fn missing_mount_and_readonly_bind_mount_are_distinct() {
        let mounts="1 0 0:1 / / rw - overlay overlay rw\n2 1 0:2 /storage /mnt/storage rw,noatime - f2fs /dev/mmcblk2p4 rw\n3 2 0:2 /storage /mnt/storage ro - f2fs /dev/mmcblk2p4 rw\n";
        assert_eq!(mount_read_only(mounts, "/mnt/storage"), Some(true));
        assert_eq!(mount_read_only(mounts, "/boot"), None);
        assert_eq!(mount_read_only(mounts, "/"), Some(false));
    }
    #[test]
    fn failed_dependency_has_priority_over_core_failure() {
        let p = Unit {
            active: "failed".into(),
            result: "exit-code".into(),
            status: 1,
            condition: true,
            pending: false,
        };
        let c = Unit {
            active: "inactive".into(),
            ..Unit::default()
        };
        let result = unit_issue(
            &p,
            &c,
            "state=failed\nstage=package-keys\nexit_code=1\n",
            false,
        )
        .unwrap();
        assert_eq!(result.code, "system-files");
        assert_eq!(result.stage, "package-keys");
        assert_eq!(result.exit_status, 1);
        assert_eq!(
            unit_issue(&p, &c, "stage=config\n", false).unwrap().code,
            "persistence-failed"
        );
        assert_eq!(
            unit_issue(&p, &c, "stage=boot-slot\n", false).unwrap().code,
            "boot-slot"
        );
    }
    #[test]
    fn oneshot_exited_is_healthy_and_stale_failure_does_not_override_it() {
        let p = Unit {
            active: "active".into(),
            result: "success".into(),
            status: 0,
            condition: true,
            pending: false,
        };
        let mut c = Unit {
            active: "active".into(),
            ..Unit::default()
        };
        assert!(unit_issue(&p, &c, "state=failed\nstage=package-keys\n", false).is_none());
        c.active = "activating".into();
        assert_eq!(unit_issue(&p, &c, "", false).unwrap().state(), "starting");
        c.active = "failed".into();
        c.status = 226;
        assert_eq!(unit_issue(&p, &c, "", false).unwrap().exit_status, 226);
    }
    #[test]
    fn skipped_condition_is_not_reported_as_a_successful_persistence_run() {
        let p = Unit {
            active: "inactive".into(),
            result: "success".into(),
            condition: false,
            ..Unit::default()
        };
        let c = Unit {
            active: "active".into(),
            ..Unit::default()
        };
        assert_eq!(
            unit_issue(&p, &c, "", false).unwrap().code,
            "persistence-skipped"
        );
        assert!(unit_issue(&p, &c, "", true).is_none());
    }
    #[test]
    fn ordered_start_jobs_are_starting_but_stopped_and_failed_units_are_errors() {
        let mut p = Unit {
            active: "inactive".into(),
            result: "success".into(),
            pending: true,
            ..Unit::default()
        };
        let mut c = Unit {
            active: "inactive".into(),
            result: "success".into(),
            pending: true,
            ..Unit::default()
        };
        assert_eq!(
            unit_issue(&p, &c, "", false).unwrap().code,
            "persistence-starting"
        );
        p.active = "active".into();
        p.condition = true;
        p.pending = false;
        assert_eq!(unit_issue(&p, &c, "", false).unwrap().code, "core-starting");
        c.pending = false;
        assert_eq!(unit_issue(&p, &c, "", false).unwrap().code, "core-failed");
        c.active = "failed".into();
        c.pending = true;
        c.status = 203;
        assert_eq!(unit_issue(&p, &c, "", false).unwrap().code, "system-files");
        p.active = "failed".into();
        p.pending = true;
        assert_eq!(
            unit_issue(&p, &c, "stage=config\n", false).unwrap().code,
            "persistence-failed"
        );
    }
    #[test]
    fn checks_coalesce_and_events_during_a_check_are_not_lost() {
        let h = Health::default();
        assert!(h.begin());
        assert!(!h.begin());
        h.invalidate();
        h.finish(issue("storage-full"));
        assert!(h.begin());
        h.finish(Snapshot::default());
        assert!(!h.begin());
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&h.snapshot()).unwrap()["state"],
            "ready"
        );
    }
    #[test]
    fn writable_probe_cleans_up_without_touching_existing_content() {
        let path = std::env::temp_dir().join(format!("onekvm-health-test-{}", std::process::id()));
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join("keep"), b"unchanged").unwrap();
        writable(&path).unwrap();
        assert_eq!(fs::read_dir(&path).unwrap().count(), 1);
        assert_eq!(fs::read(path.join("keep")).unwrap(), b"unchanged");
        fs::remove_dir_all(path).unwrap();
    }
}
