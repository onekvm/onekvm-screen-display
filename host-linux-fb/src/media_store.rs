//! File-backed media. HTTP bodies never pass through settings JSON or D-Bus.
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use anyhow::{bail, Context, Result};
use serde_json::json;

static UPLOAD: Mutex<()> = Mutex::new(());

/// Saving removes retired assets. Uncommitted drafts get a day of grace so
/// an open designer in another tab is not invalidated by unrelated saves.
pub fn prune(directory: &Path, keep: &std::collections::HashSet<String>, retired: &std::collections::HashSet<String>) {
    let Ok(entries) = fs::read_dir(directory) else { return; };
    for entry in entries.flatten() {
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else { continue; };
        if keep.contains(&name) { continue; }
        let is_part = name.strip_suffix(".part").is_some_and(|token| path(directory, &format!("{token}.mp4")).is_ok());
        if path(directory, &name).is_err() && !is_part { continue; }
        let expired = entry.metadata().ok().and_then(|m| m.modified().ok()).and_then(|t| t.elapsed().ok()).is_some_and(|age| age.as_secs() > 86400);
        if retired.contains(&name) || expired { let _ = fs::remove_file(entry.path()); }
    }
}

pub fn path(directory: &Path, name: &str) -> Result<PathBuf> {
    let token = name.split_once('.').filter(|(_, extension)| matches!(*extension, "mp4" | "png" | "jpg" | "gif" | "webp" | "bmp" | "avif")).map(|(token, _)| token).unwrap_or("");
    if token.len() != 32 || !token.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
        bail!("invalid media filename");
    }
    Ok(directory.join(name))
}

pub fn is_image(name: &str) -> bool {
    !name.ends_with(".mp4") && path(Path::new(""), name).is_ok()
}

fn content_type(name: &str) -> &'static str {
    match name.rsplit('.').next().unwrap_or("") {
        "png" => "image/png", "jpg" => "image/jpeg", "gif" => "image/gif",
        "webp" => "image/webp", "bmp" => "image/bmp", "avif" => "image/avif",
        _ => "video/mp4",
    }
}

struct Partial(PathBuf);
impl Drop for Partial {
    fn drop(&mut self) { let _ = fs::remove_file(&self.0); }
}

fn receive(directory: &Path, size: u64, input: &mut impl Read) -> Result<serde_json::Value> {
    let _upload = UPLOAD.try_lock().map_err(|_| anyhow::anyhow!("another media upload is active"))?;
    if size < 12 { bail!("empty MP4 upload"); }
    fs::create_dir_all(directory)?;
    let mut random = [0u8; 16];
    File::open("/dev/urandom")?.read_exact(&mut random)?;
    let token: String = random.iter().map(|b| format!("{b:02x}")).collect();
    let partial = Partial(directory.join(format!("{token}.part")));
    let mut file = OpenOptions::new().write(true).create_new(true).mode(0o600).open(&partial.0)?;
    // copy uses a fixed-size buffer; take also detects a disconnected short body.
    if std::io::copy(&mut input.take(size), &mut file)? != size { bail!("incomplete MP4 upload"); }
    file.sync_all()?;
    drop(file);
    let video = crate::video_decode::demux_mp4_file(&partial.0)?;
    let duration = video.samples.iter().map(|s| s.presentation_ms.saturating_add(s.duration_ms)).max().unwrap_or(0).max(1);
    let filename = format!("{token}.mp4");
    fs::rename(&partial.0, path(directory, &filename)?)?;
    File::open(directory)?.sync_all()?;
    Ok(json!({"v":3, "format":"mp4", "container":"mp4", "codec":"h264", "file":filename,
        "width":video.config.width, "height":video.config.height, "duration_ms":duration,
        "size_bytes":size, "durations":[], "frames":[]}))
}

fn receive_image(directory: &Path, size: u64, input: &mut impl Read) -> Result<serde_json::Value> {
    let _upload = UPLOAD.try_lock().map_err(|_| anyhow::anyhow!("another media upload is active"))?;
    if size < 12 { bail!("empty image upload"); }
    fs::create_dir_all(directory)?;
    let mut random = [0u8; 16];
    File::open("/dev/urandom")?.read_exact(&mut random)?;
    let token: String = random.iter().map(|b| format!("{b:02x}")).collect();
    let partial = Partial(directory.join(format!("{token}.part")));
    let mut file = OpenOptions::new().write(true).create_new(true).mode(0o600).open(&partial.0)?;
    if std::io::copy(&mut input.take(size), &mut file)? != size { bail!("incomplete image upload"); }
    file.sync_all()?;
    drop(file);
    let mut header = [0u8; 64];
    let length = File::open(&partial.0)?.read(&mut header)?;
    let header = &header[..length];
    let extension = if header.starts_with(b"\x89PNG\r\n\x1a\n") && header.get(12..16) == Some(b"IHDR") { "png" }
        else if header.starts_with(b"\xff\xd8\xff") { "jpg" }
        else if header.starts_with(b"GIF87a") || header.starts_with(b"GIF89a") { "gif" }
        else if header.starts_with(b"RIFF") && header.get(8..12) == Some(b"WEBP") { "webp" }
        else if header.starts_with(b"BM") && length >= 26 { "bmp" }
        else if header.get(4..8) == Some(b"ftyp") && header[8..].chunks_exact(4).any(|brand| brand == b"avif" || brand == b"avis") { "avif" }
        else { bail!("unsupported image upload"); };
    let filename = format!("{token}.{extension}");
    fs::rename(&partial.0, path(directory, &filename)?)?;
    File::open(directory)?.sync_all()?;
    Ok(json!({"file":filename, "size_bytes":size}))
}

fn reply(output: &mut impl Write, status: &str, body: &[u8]) -> Result<()> {
    write!(output, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nCache-Control: private, no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len())?;
    output.write_all(body)?;
    Ok(())
}

pub fn serve(directory: &Path, method: &str, request: &str, size: Option<u64>, range: Option<&str>, input: &mut impl Read, output: &mut impl Write) -> Result<()> {
    if method == "POST" && matches!(request, "/media" | "/media/image") {
        let Some(size) = size else { return reply(output, "411 Length Required", b"{}"); };
        let result = if request == "/media/image" { receive_image(directory, size, input) } else { receive(directory, size, input) };
        return match result {
            Ok(asset) => reply(output, "201 Created", &serde_json::to_vec(&asset)?),
            Err(err) => {
                log::warn!("media upload: {err:#}");
                reply(output, "400 Bad Request", &serde_json::to_vec(&json!({"error":err.to_string()}))?)
            }
        };
    }
    if !matches!(method, "GET" | "HEAD") { return reply(output, "405 Method Not Allowed", b"{}"); }
    let Some(name) = request.strip_prefix("/media/") else { return reply(output, "404 Not Found", b"{}"); };
    let mut file = match path(directory, name).and_then(|p| File::open(p).context("open media")) {
        Ok(file) => file,
        Err(_) => return reply(output, "404 Not Found", b"{}"),
    };
    let total = file.metadata()?.len();
    let (start, end) = match byte_range(range, total) {
        Ok(range) => range,
        Err(_) => {
            write!(output, "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{total}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")?;
            return Ok(());
        }
    };
    let status = if range.is_some() { "206 Partial Content" } else { "200 OK" };
    write!(output, "HTTP/1.1 {status}\r\nContent-Type: {}\r\nX-Content-Type-Options: nosniff\r\nAccept-Ranges: bytes\r\nCache-Control: private, no-store\r\nContent-Length: {}\r\nConnection: close\r\n", content_type(name), end - start + 1)?;
    if range.is_some() { write!(output, "Content-Range: bytes {start}-{end}/{total}\r\n")?; }
    output.write_all(b"\r\n")?;
    if method != "HEAD" {
        file.seek(SeekFrom::Start(start))?;
        std::io::copy(&mut file.take(end - start + 1), output)?;
    }
    Ok(())
}

fn byte_range(range: Option<&str>, total: u64) -> Result<(u64, u64)> {
    if total == 0 { bail!("empty file"); }
    let Some(range) = range else { return Ok((0, total - 1)); };
    let (start, end) = range.strip_prefix("bytes=").and_then(|s| s.split_once('-')).context("invalid range")?;
    let (start, end) = if start.is_empty() {
        let suffix = end.parse::<u64>()?;
        if suffix == 0 { bail!("empty suffix"); }
        (total.saturating_sub(suffix), total - 1)
    } else {
        (start.parse::<u64>()?, if end.is_empty() { total - 1 } else { end.parse::<u64>()?.min(total - 1) })
    };
    if start >= total || end < start { bail!("unsatisfiable range"); }
    Ok((start, end))
}

#[cfg(test)]
mod tests {
    use super::*;
    static TEST_UPLOAD: Mutex<()> = Mutex::new(());

    #[test]
    fn browser_ranges_and_traversal() {
        assert_eq!(byte_range(Some("bytes=10-19"), 100).unwrap(), (10, 19));
        assert_eq!(byte_range(Some("bytes=10-"), 100).unwrap(), (10, 99));
        assert_eq!(byte_range(Some("bytes=-10"), 100).unwrap(), (90, 99));
        for value in ["bytes=100-", "bytes=-0", "bytes=20-10", "bytes=0-1,3-4"] {
            assert!(byte_range(Some(value), 100).is_err());
        }
        assert!(path(Path::new("/tmp"), "../media.mp4").is_err());
        assert!(path(Path::new("/tmp"), "/etc/passwd").is_err());
    }

    #[test]
    fn aborted_or_invalid_upload_leaves_no_partial_or_published_file() {
        let _test = TEST_UPLOAD.lock().unwrap();
        let directory = std::env::temp_dir().join(format!("onekvm-media-abort-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        assert!(receive(&directory, 100_000_000, &mut &b"short"[..]).is_err());
        assert!(receive(&directory, 12, &mut &b"not an mp4!!"[..]).is_err());
        assert!(receive_image(&directory, 1000, &mut &b"short"[..]).is_err());
        assert!(receive_image(&directory, 12, &mut &b"not an image"[..]).is_err());
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 0);
        fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn original_image_round_trips_bytes_metadata_and_file_retention() {
        let _test = TEST_UPLOAD.lock().unwrap();
        let directory = std::env::temp_dir().join(format!("onekvm-image-original-{}", std::process::id()));
        let original = crate::background::decode_base64("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2u0AAAAASUVORK5CYII=").unwrap();
        let mut metadata = receive_image(&directory, original.len() as u64, &mut &original[..]).unwrap();
        let name = metadata["file"].as_str().unwrap().to_string();
        assert_eq!(fs::read(path(&directory, &name).unwrap()).unwrap(), original);
        metadata["width"] = json!(1920);
        metadata["height"] = json!(2830);
        let settings = json!({"v":2,"assets":{"portrait":{"v":1,"format":"image","name":"portrait.png","width":1,"height":1,"frames":["AQA="],"durations":[1000],"original":metadata}}}).to_string();
        let library = crate::widget_media::MediaLibrary::parse_with_directory(&settings, &directory).unwrap().unwrap();
        assert_eq!(serde_json::from_str::<serde_json::Value>(library.encoded()).unwrap()["assets"]["portrait"]["original"], metadata);
        prune(&directory, library.files(), &std::collections::HashSet::from([name.clone()]));
        assert!(path(&directory, &name).unwrap().exists());
        let mut response = Vec::new();
        serve(&directory, "GET", &format!("/media/{name}"), None, None, &mut std::io::empty(), &mut response).unwrap();
        assert!(response.windows(b"Content-Type: image/png".len()).any(|part| part == b"Content-Type: image/png"));
        assert!(response.ends_with(&original));
        prune(&directory, &std::collections::HashSet::new(), library.files());
        assert!(!path(&directory, &name).unwrap().exists());
        fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn upload_over_100_mib_stays_file_backed_and_samples_can_loop() {
        let _test = TEST_UPLOAD.lock().unwrap();
        let directory = std::env::temp_dir().join(format!("onekvm-media-large-{}", std::process::id()));
        let fixture = include_bytes!("../tests/fixtures/main-b-frames.mp4");
        let extra = 128 * 1024 * 1024u32;
        let mut free = Vec::from(extra.to_be_bytes());
        free.extend_from_slice(b"free");
        struct Bounded<R>(R);
        impl<R: Read> Read for Bounded<R> {
            fn read(&mut self, bytes: &mut [u8]) -> std::io::Result<usize> {
                assert!(bytes.len() <= 64 * 1024, "upload buffer grew with file size");
                self.0.read(bytes)
            }
        }
        let size = fixture.len() as u64 + extra as u64;
        let mut source = Bounded((&fixture[..]).chain(&free[..]).chain(std::io::repeat(0).take(extra as u64 - 8)));
        let metadata = receive(&directory, size, &mut source).unwrap();
        let file = path(&directory, metadata["file"].as_str().unwrap()).unwrap();
        assert_eq!(fs::metadata(&file).unwrap().len(), size);
        let mut video = crate::video_decode::demux_mp4_file(&file).unwrap();
        assert!(video.samples.iter().all(|sample| sample.bytes.is_empty()));
        let original = crate::video_decode::demux_mp4(fixture).unwrap();
        for _ in 0..2 {
            for (index, expected) in original.samples.iter().enumerate() {
                let actual = video.sample(index).unwrap();
                assert_eq!(actual.bytes, expected.bytes);
                assert_eq!(actual.presentation_ms, expected.presentation_ms);
                assert_eq!(actual.is_sync, expected.is_sync);
            }
        }
        let settings = json!({"v":2,"assets":{"large":metadata}}).to_string();
        assert!(settings.len() < 1024);
        assert!(crate::widget_media::MediaLibrary::parse_with_directory(&settings, &directory).unwrap().is_some());
        // Range reads are also bounded and do not turn previews into full downloads.
        let mut response = Vec::new();
        serve(&directory, "GET", &format!("/media/{}", metadata["file"].as_str().unwrap()), None, Some("bytes=0-15"), &mut std::io::empty(), &mut response).unwrap();
        assert!(response.starts_with(b"HTTP/1.1 206"));
        assert_eq!(&response[response.len()-16..], &fixture[..16]);
        drop(video);
        fs::remove_dir_all(directory).unwrap();
    }
}
