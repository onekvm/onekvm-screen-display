//! Blocking event worker: no catalog scans or widget RPCs on a timer/frame.
use std::collections::{BTreeMap, BTreeSet};
use std::ffi::{CString, OsStr};
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::os::unix::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::shared::Shared;
use anyhow::{Context, Result};

pub struct Notify(OwnedFd);

impl Default for Notify {
    fn default() -> Self {
        let fd = unsafe { libc::eventfd(0, libc::EFD_CLOEXEC | libc::EFD_NONBLOCK) };
        assert!(fd >= 0, "eventfd: {}", std::io::Error::last_os_error());
        Self(unsafe { OwnedFd::from_raw_fd(fd) })
    }
}

impl Notify {
    pub fn notify(&self) {
        let value = 1u64;
        unsafe {
            libc::write(self.0.as_raw_fd(), (&value as *const u64).cast(), 8);
        }
    }

    fn drain(&self) {
        let mut value = 0u64;
        unsafe {
            libc::read(self.0.as_raw_fd(), (&mut value as *mut u64).cast(), 8);
        }
    }
}

struct Files {
    fd: OwnedFd,
    watches: BTreeMap<i32, PathBuf>,
    targets: Vec<PathBuf>,
}

impl Files {
    fn new() -> Result<Self> {
        let fd = unsafe { libc::inotify_init1(libc::IN_CLOEXEC | libc::IN_NONBLOCK) };
        anyhow::ensure!(fd >= 0, "inotify: {}", std::io::Error::last_os_error());
        Ok(Self {
            fd: unsafe { OwnedFd::from_raw_fd(fd) },
            watches: BTreeMap::new(),
            targets: Vec::new(),
        })
    }

    fn update(&mut self, targets: Vec<PathBuf>) -> Result<bool> {
        let cwd = std::env::current_dir()?;
        let mut next: Vec<_> = targets
            .into_iter()
            .map(|p| {
                let absolute = if p.is_absolute() { p } else { cwd.join(p) };
                let mut normalized = PathBuf::new();
                for part in absolute.components() {
                    match part {
                        std::path::Component::CurDir => {}
                        std::path::Component::ParentDir => {
                            normalized.pop();
                        }
                        part => normalized.push(part.as_os_str()),
                    }
                }
                normalized
            })
            .collect();
        next.sort();
        next.dedup();
        let changed = next != self.targets;
        self.targets = next;
        let mut dirs = BTreeSet::new();
        for target in &self.targets {
            collect_dirs(target, &mut dirs);
            // Parent watches survive atomic replacement and the first install.
            for parent in target.ancestors().skip(1) {
                if parent.is_dir() {
                    dirs.insert(parent.to_path_buf());
                }
            }
        }
        let removed: Vec<_> = self
            .watches
            .iter()
            .filter(|(_, p)| !dirs.contains(*p))
            .map(|(wd, _)| *wd)
            .collect();
        for wd in removed {
            self.watches.remove(&wd);
            unsafe {
                libc::inotify_rm_watch(self.fd.as_raw_fd(), wd);
            }
        }
        for dir in dirs {
            if self.watches.values().any(|p| p == &dir) {
                continue;
            }
            let path = CString::new(dir.as_os_str().as_bytes())?;
            let mask = libc::IN_CLOSE_WRITE
                | libc::IN_MOVED_TO
                | libc::IN_MOVED_FROM
                | libc::IN_CREATE
                | libc::IN_DELETE
                | libc::IN_DELETE_SELF
                | libc::IN_MOVE_SELF
                | libc::IN_ATTRIB
                | libc::IN_ONLYDIR;
            let wd = unsafe { libc::inotify_add_watch(self.fd.as_raw_fd(), path.as_ptr(), mask) };
            if wd >= 0 {
                self.watches.insert(wd, dir);
            } else if dir.exists() {
                anyhow::bail!(
                    "watch {}: {}",
                    dir.display(),
                    std::io::Error::last_os_error()
                );
            }
        }
        Ok(changed)
    }

    fn changed(&mut self) -> bool {
        let mut changed = false;
        let mut overflow = false;
        let mut buf = [0u8; 64 * 1024];
        loop {
            let n = unsafe { libc::read(self.fd.as_raw_fd(), buf.as_mut_ptr().cast(), buf.len()) };
            if n <= 0 {
                break;
            }
            let mut offset = 0;
            while offset + std::mem::size_of::<libc::inotify_event>() <= n as usize {
                let event = unsafe {
                    std::ptr::read_unaligned(buf.as_ptr().add(offset).cast::<libc::inotify_event>())
                };
                let start = offset + std::mem::size_of::<libc::inotify_event>();
                let end = start + event.len as usize;
                if end > n as usize {
                    break;
                }
                if event.mask & libc::IN_Q_OVERFLOW != 0 {
                    log::warn!("catalog file event overflow; reconciling");
                    overflow = true;
                    changed = true;
                }
                if let Some(dir) = self.watches.get(&event.wd) {
                    let name = buf[start..end]
                        .split(|b| *b == 0)
                        .next()
                        .unwrap_or_default();
                    let path = dir.join(OsStr::from_bytes(name));
                    changed |= self.targets.iter().any(|target| affects_target(&path, event.mask, target));
                }
                if event.mask & libc::IN_IGNORED != 0 {
                    self.watches.remove(&event.wd);
                }
                offset = end;
            }
        }
        if overflow {
            // IN_IGNORED may itself have been dropped. Reinstall even watches
            // whose path still exists, rather than trusting stale descriptors.
            for wd in self.watches.keys() {
                unsafe {
                    libc::inotify_rm_watch(self.fd.as_raw_fd(), *wd);
                }
            }
            self.watches.clear();
        }
        changed
    }
}

fn affects_target(path: &Path, mask: u32, target: &Path) -> bool {
    // Ancestors are watched to discover first creation and atomic replacement.
    // Reapplying permissions to an ancestor does not change a bundle. Treating
    // IN_ATTRIB there as content invalidation can feed discovery back into itself.
    let structural = libc::IN_CREATE | libc::IN_DELETE | libc::IN_MOVED_TO
        | libc::IN_MOVED_FROM | libc::IN_DELETE_SELF | libc::IN_MOVE_SELF;
    path.starts_with(target) || (mask & structural != 0 && target.starts_with(path))
}

fn collect_dirs(path: &Path, dirs: &mut BTreeSet<PathBuf>) {
    if !path.is_dir() || !dirs.insert(path.to_path_buf()) {
        return;
    }
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
                collect_dirs(&entry.path(), dirs);
            }
        }
    }
}

fn targets() -> Vec<PathBuf> {
    let mut paths = if crate::mode::is_init() {
        Vec::new()
    } else {
        crate::apps::watch_paths()
    };
    paths.extend(
        [
            "/run/onekvm/contributions-generation",
            "/etc/localtime",
            "/data/onekvm/wifi-ap-password",
            "/data/onekvm/wifi-ap-settings.json",
            "/run/onekvm/hostapd.conf",
            "/run/onekvm/hostapd.pid",
            "/run/hostapd",
        ]
        .map(PathBuf::from),
    );
    paths
}

pub fn spawn(shared: Arc<Shared>) {
    std::thread::spawn(move || loop {
        if let Err(err) = run(&shared) {
            log::error!("screen event worker: {err:#}; reattaching");
        }
        std::thread::sleep(std::time::Duration::from_secs(1));
    });
}

fn run(shared: &Shared) -> Result<()> {
    let mut files = Files::new()?;
    files.update(targets())?;
    shared.refresh_catalog();
    shared.refresh_wifi_setup();
    if files.update(targets())? {
        // Discovery can reveal a previously unknown contributed bundle.
        // Subscribe to it before taking its authoritative snapshot.
        shared.refresh_catalog();
        files.update(targets())?;
    }
    loop {
        let mut fds = [
            libc::pollfd {
                fd: files.fd.as_raw_fd(),
                events: libc::POLLIN,
                revents: 0,
            },
            libc::pollfd {
                fd: shared.catalog_event.0.as_raw_fd(),
                events: libc::POLLIN,
                revents: 0,
            },
        ];
        if unsafe { libc::poll(fds.as_mut_ptr(), fds.len() as _, -1) } < 0 {
            let err = std::io::Error::last_os_error();
            if err.kind() == std::io::ErrorKind::Interrupted {
                continue;
            }
            return Err(err).context("wait for catalog events");
        }
        let requested = fds[1].revents & libc::POLLIN != 0;
        if requested {
            shared.catalog_event.drain();
        }
        if files.changed() || requested {
            files.update(targets())?;
            crate::locale::sync_process_timezone();
            shared.refresh_catalog();
            shared.refresh_wifi_setup();
            if files.update(targets())? {
                shared.refresh_catalog();
                files.update(targets())?;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ancestor_metadata_does_not_invalidate_descendant_catalogs() {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(format!("screen-events-attributes-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let target = root.join("apps");
        let mut files = Files::new().unwrap();
        files.update(vec![target.clone()]).unwrap();
        let permissions = std::fs::metadata(&root).unwrap().permissions().mode();
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(permissions)).unwrap();
        assert!(!files.changed(), "ancestor chmod must not refresh the catalog");
        std::fs::create_dir(&target).unwrap();
        assert!(files.changed(), "first installation must still be discovered");
        files.update(vec![target.clone()]).unwrap();
        std::fs::write(root.join("unrelated"), "status").unwrap();
        assert!(!files.changed(), "sibling state writes must not refresh Apps");
        std::fs::write(target.join("plugin.json"), "{}").unwrap();
        assert!(files.changed(), "bundle writes must still refresh Apps");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn watches_first_creation_nested_writes_atomic_replace_and_removal() {
        let root = std::env::temp_dir().join(format!("screen-events-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let target = root.join("missing/apps");
        let mut files = Files::new().unwrap();
        files.update(vec![target.clone()]).unwrap();
        std::fs::create_dir_all(&target).unwrap();
        assert!(files.changed());
        files.update(vec![target.clone()]).unwrap();
        std::fs::write(target.join("bundle"), b"old").unwrap();
        assert!(files.changed());
        std::fs::write(target.join("tmp"), b"new").unwrap();
        std::fs::rename(target.join("tmp"), target.join("bundle")).unwrap();
        assert!(files.changed());
        std::fs::remove_dir_all(&target).unwrap();
        assert!(files.changed());
        files.update(vec![target.clone()]).unwrap();
        std::fs::create_dir_all(&target).unwrap();
        assert!(files.changed());
        assert!(!files.changed());
        std::fs::remove_dir_all(root).unwrap();
    }
}
