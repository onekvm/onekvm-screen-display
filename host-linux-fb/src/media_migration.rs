//! Convert legacy inline videos before loading their samples into the renderer.
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use serde_json::Value;
use sha2::{Digest, Sha256};

struct Partial(PathBuf);
impl Drop for Partial {
    fn drop(&mut self) { let _ = fs::remove_file(&self.0); }
}

fn file_digest(path: &Path) -> Result<Vec<u8>> {
    let mut file = File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0; 16 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 { return Ok(digest.finalize().to_vec()); }
        digest.update(&buffer[..read]);
    }
}

fn materialize(encoded: &str, directory: &Path) -> Result<(String, u64)> {
    fs::create_dir_all(directory).context("create media directory")?;
    let mut random = [0; 16];
    File::open("/dev/urandom")?.read_exact(&mut random)?;
    let token: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
    let partial = Partial(directory.join(format!("{token}.part")));
    let mut file = OpenOptions::new().write(true).create_new(true).mode(0o600).open(&partial.0)?;
    let mut digest = Sha256::new();
    let mut size = 0u64;
    // Legacy data is already in JSON; never allocate a second full MP4 buffer.
    const CHUNK: usize = 64 * 1024;
    if encoded.is_empty() || encoded.len() % 4 != 0 { bail!("invalid inline MP4 base64 length"); }
    for (index, chunk) in encoded.as_bytes().chunks(CHUNK).enumerate() {
        let chunk = std::str::from_utf8(chunk).context("invalid inline MP4 base64")?;
        if (index + 1) * CHUNK < encoded.len() && chunk.contains('=') {
            bail!("invalid inline MP4 base64 padding");
        }
        let decoded = crate::background::decode_base64(chunk).map_err(anyhow::Error::msg)?;
        file.write_all(&decoded)?;
        digest.update(&decoded);
        size += decoded.len() as u64;
    }
    file.sync_all()?;
    drop(file);
    // Validate without retaining compressed samples, then publish immutable data.
    crate::video_decode::demux_mp4_file(&partial.0).context("validate migrated MP4")?;
    let digest = digest.finalize();
    let name = format!("{}.mp4", digest[..16].iter().map(|byte| format!("{byte:02x}")).collect::<String>());
    let destination = crate::media_store::path(directory, &name)?;
    match fs::hard_link(&partial.0, &destination) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            if fs::metadata(&destination)?.len() != size || file_digest(&destination)? != digest.as_slice() {
                bail!("migrated MP4 conflicts with existing media file");
            }
        }
        Err(error) => return Err(error).context("publish migrated MP4"),
    }
    drop(partial);
    File::open(directory)?.sync_all()?;
    Ok((name, size))
}

/// A failed/retried metadata save reuses the content-addressed immutable files.
/// Completed files follow the media store's normal orphan grace period.
pub fn prepare(raw: &str, directory: &Path) -> Result<Option<String>> {
    if raw.trim().is_empty() { return Ok(None); }
    let mut value: Value = serde_json::from_str(raw).context("parse media assets for migration")?;
    if !matches!(value.get("v").and_then(Value::as_u64), Some(1 | 2 | 3)) {
        bail!("unsupported media asset version");
    }
    let assets = value.get_mut("assets").and_then(Value::as_object_mut).context("media assets are missing")?;
    let mut changed = false;
    for (id, asset) in assets {
        if asset["v"] != 2 || asset["format"] != "mp4" { continue; }
        let encoded = asset.get("data").and_then(Value::as_str).context("missing inline MP4 data")?;
        let (name, size) = materialize(encoded, directory).with_context(|| format!("migrate media {id}"))?;
        let asset = asset.as_object_mut().context("invalid media asset")?;
        asset.remove("data");
        asset.insert("v".into(), 3.into());
        asset.insert("file".into(), name.into());
        asset.insert("size_bytes".into(), size.into());
        changed = true;
    }
    if changed { Ok(Some(serde_json::to_string(&value)?)) } else { Ok(None) }
}

fn persist(data_dir: &Path, encoded: &str) -> Result<()> {
    let temporary = Partial(data_dir.join(".media-assets.migration.tmp"));
    let mut file = OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(&temporary.0)?;
    file.write_all(encoded.as_bytes())?;
    file.sync_all()?;
    fs::rename(&temporary.0, data_dir.join("media-assets.json"))?;
    File::open(data_dir)?.sync_all()?;
    Ok(())
}

pub fn load(raw: &str, data_dir: &Path) -> Result<Option<crate::widget_media::MediaLibrary>, String> {
    let directory = data_dir.join("media");
    let migrated = match prepare(raw, &directory) {
        Ok(value) => value,
        Err(error) => {
            // A full/read-only device must retain access to its original assets.
            log::warn!("inline media migration deferred: {error:#}");
            None
        }
    };
    let mut library = crate::widget_media::MediaLibrary::parse_with_directory(migrated.as_deref().unwrap_or(raw), &directory)?;
    if let (Some(_), Some(library)) = (migrated, &library) {
        if let Err(error) = persist(data_dir, library.encoded()) {
            // Files are already durable; use the small metadata in memory. If
            // metadata was not replaced, next boot retries using the same files.
            log::warn!("persist migrated media metadata: {error:#}");
        } else {
            log::info!("migrated inline MP4 assets to file-backed media");
        }
    }
    if let Some(library) = library.as_mut() { library.map_metadata(&data_dir.join("media-assets.json")); }
    Ok(library)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT: AtomicU64 = AtomicU64::new(0);
    struct TestDir(PathBuf);
    impl TestDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("onekvm-migration-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for TestDir { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }

    fn encode(data: &[u8]) -> String {
        const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut encoded = String::new();
        for chunk in data.chunks(3) {
            let value = (u32::from(chunk[0]) << 16) | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8) | u32::from(*chunk.get(2).unwrap_or(&0));
            for index in 0..4 {
                encoded.push(if index > chunk.len() { '=' } else { ALPHABET[((value >> (18 - index * 6)) & 63) as usize] as char });
            }
        }
        encoded
    }

    fn legacy() -> String {
        let encoded = encode(include_bytes!("../tests/fixtures/main-b-frames.mp4"));
        serde_json::json!({"v":2,"assets":{
            "movie":{"v":2,"format":"mp4","container":"mp4","codec":"h264","width":64,"height":48,"duration_ms":1000,"name":"Original movie","data":encoded,"frames":[],"durations":[]},
            "still":{"v":1,"format":"image","width":1,"height":1,"frames":["//8="],"durations":[100]}
        }}).to_string()
    }

    #[test]
    fn migration_preserves_bytes_identity_other_assets_and_looping() {
        let directory = TestDir::new();
        let raw = legacy();
        fs::write(directory.0.join("media-assets.json"), &raw).unwrap();
        let library = load(&raw, &directory.0).unwrap().unwrap();
        let saved = fs::read_to_string(directory.0.join("media-assets.json")).unwrap();
        assert_eq!(library.encoded(), saved);
        let before: Value = serde_json::from_str(&raw).unwrap();
        let after: Value = serde_json::from_str(&saved).unwrap();
        let movie = &after["assets"]["movie"];
        assert_eq!(movie["v"], 3);
        assert!(movie.get("data").is_none());
        assert_eq!(movie["name"], "Original movie");
        assert_eq!(after["assets"]["still"], before["assets"]["still"]);
        let file = crate::media_store::path(&directory.0.join("media"), movie["file"].as_str().unwrap()).unwrap();
        let fixture = include_bytes!("../tests/fixtures/main-b-frames.mp4");
        assert_eq!(fs::read(&file).unwrap(), fixture);
        let original = crate::video_decode::demux_mp4(fixture).unwrap();
        let mut video = crate::video_decode::demux_mp4_file(&file).unwrap();
        assert!(video.samples.iter().all(|sample| sample.bytes.is_empty()));
        for _ in 0..2 {
            for (index, expected) in original.samples.iter().enumerate() {
                let actual = video.sample(index).unwrap();
                assert_eq!(actual.bytes, expected.bytes);
                assert_eq!(actual.presentation_ms, expected.presentation_ms);
            }
        }
        assert!(prepare(&saved, &directory.0.join("media")).unwrap().is_none());
        // A stale editor / interrupted metadata commit reuses the existing file.
        assert_eq!(prepare(&raw, &directory.0.join("media")).unwrap().unwrap(), saved);
        assert_eq!(fs::read_dir(directory.0.join("media")).unwrap().count(), 1);
    }

    #[test]
    fn invalid_video_never_replaces_original_metadata_or_leaves_partials() {
        let directory = TestDir::new();
        let mut value: Value = serde_json::from_str(&legacy()).unwrap();
        value["assets"]["movie"]["data"] = "bm90IGFuIE1QNA==".into();
        let raw = value.to_string();
        fs::write(directory.0.join("media-assets.json"), &raw).unwrap();
        assert!(load(&raw, &directory.0).is_err());
        assert_eq!(fs::read_to_string(directory.0.join("media-assets.json")).unwrap(), raw);
        assert_eq!(fs::read_dir(directory.0.join("media")).unwrap().count(), 0);
    }

    #[test]
    fn failed_publication_preserves_source_and_can_retry() {
        let directory = TestDir::new();
        let raw = legacy();
        fs::write(directory.0.join("media-assets.json"), &raw).unwrap();
        fs::create_dir(directory.0.join(".media-assets.migration.tmp")).unwrap();
        let library = load(&raw, &directory.0).unwrap().unwrap();
        assert!(!library.encoded().contains("\"data\":"));
        assert_eq!(fs::read_to_string(directory.0.join("media-assets.json")).unwrap(), raw);
        fs::remove_dir(directory.0.join(".media-assets.migration.tmp")).unwrap();
        load(&raw, &directory.0).unwrap();
        assert_eq!(fs::read_dir(directory.0.join("media")).unwrap().count(), 1);
        assert_ne!(fs::read_to_string(directory.0.join("media-assets.json")).unwrap(), raw);
    }

    #[test]
    fn migration_crosses_base64_chunks_and_rejects_internal_padding() {
        let directory = TestDir::new();
        let mut data = include_bytes!("../tests/fixtures/main-b-frames.mp4").to_vec();
        let size = 128 * 1024u32;
        data.extend_from_slice(&size.to_be_bytes());
        data.extend_from_slice(b"free");
        data.resize(data.len() + size as usize - 8, 0);
        let (name, size) = materialize(&encode(&data), &directory.0).unwrap();
        assert_eq!(size, data.len() as u64);
        assert_eq!(fs::read(directory.0.join(name)).unwrap(), data);
        let bad = "AA==".repeat(16_384) + "AAAA";
        assert!(materialize(&bad, &directory.0).is_err());
        assert_eq!(fs::read_dir(&directory.0).unwrap().count(), 1);
    }

    #[test]
    fn corrupt_existing_file_is_never_overwritten_or_referenced() {
        let directory = TestDir::new();
        let raw = legacy();
        let first = prepare(&raw, &directory.0).unwrap().unwrap();
        let metadata: Value = serde_json::from_str(&first).unwrap();
        let file = directory.0.join(metadata["assets"]["movie"]["file"].as_str().unwrap());
        fs::write(&file, b"corrupt").unwrap();
        assert!(prepare(&raw, &directory.0).is_err());
        assert_eq!(fs::read(&file).unwrap(), b"corrupt");
        assert_eq!(fs::read_dir(&directory.0).unwrap().count(), 1);
    }
}
