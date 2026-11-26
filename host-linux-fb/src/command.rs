//! Bounded, cancellable subprocesses. No pipe is read into an unbounded buffer.
use std::io::{Read, Write};
use std::os::fd::AsRawFd;
use std::os::unix::process::CommandExt;
use std::process::{Child, Command, Output, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

struct Running(Child);
impl Drop for Running {
    fn drop(&mut self) {
        // Also close inherited pipes held by descendants, and always reap.
        unsafe {
            libc::kill(-(self.0.id() as i32), libc::SIGKILL);
        }
        let _ = self.0.wait();
    }
}

fn nonblocking(fd: &impl AsRawFd) -> Result<(), String> {
    let fd = fd.as_raw_fd();
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}

fn drain(pipe: &mut impl Read, bytes: &mut Vec<u8>, limit: usize) -> Result<bool, String> {
    let mut chunk = [0; 4096];
    loop {
        match pipe.read(&mut chunk) {
            Ok(0) => return Ok(true),
            Ok(n) => {
                if bytes.len().saturating_add(n) > limit {
                    return Err("extension output limit exceeded".into());
                }
                bytes.extend_from_slice(&chunk[..n]);
                // Yield to cancellation/deadline checks even for a continuous writer.
                if n == chunk.len() {
                    return Ok(false);
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => return Ok(false),
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
}

pub fn run(
    command: &mut Command,
    input: &[u8],
    timeout: Duration,
    limit: usize,
    cancel: &AtomicBool,
) -> Result<Output, String> {
    let mut child = Running(
        command
            .process_group(0)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?,
    );
    let mut stdin = child.0.stdin.take();
    let mut stdout = child.0.stdout.take().ok_or("missing stdout")?;
    let mut stderr = child.0.stderr.take().ok_or("missing stderr")?;
    if let Some(pipe) = stdin.as_ref() {
        nonblocking(pipe)?;
    }
    nonblocking(&stdout)?;
    nonblocking(&stderr)?;
    let deadline = Instant::now() + timeout;
    let (mut out, mut err, mut written) = (Vec::new(), Vec::new(), 0);
    loop {
        if cancel.load(Ordering::Acquire) {
            return Err("App session closed".into());
        }
        if Instant::now() >= deadline {
            return Err("extension call timed out".into());
        }
        if let Some(pipe) = stdin.as_mut() {
            match pipe.write(&input[written..]) {
                Ok(n) => written += n,
                Err(e)
                    if matches!(
                        e.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted
                    ) => {}
                Err(e) => return Err(format!("write extension request: {e}")),
            }
            if written == input.len() {
                stdin.take();
            }
        }
        let out_done = drain(&mut stdout, &mut out, limit)?;
        let err_done = drain(&mut stderr, &mut err, 4096)?;
        if let Some(status) = child.0.try_wait().map_err(|e| e.to_string())? {
            if out_done && err_done {
                return Ok(Output {
                    status,
                    stdout: out,
                    stderr: err,
                });
            }
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn timeout_output_limits_and_cancellation_reap_children() {
        let cancel = AtomicBool::new(false);
        assert!(run(
            Command::new("/bin/sh").args(["-c", "sleep 30"]),
            b"",
            Duration::from_millis(50),
            100,
            &cancel
        )
        .unwrap_err()
        .contains("timed out"));
        assert!(run(
            Command::new("/bin/sh").args(["-c", "yes x"]),
            b"",
            Duration::from_secs(2),
            100,
            &cancel
        )
        .unwrap_err()
        .contains("limit"));
        cancel.store(true, Ordering::Release);
        assert!(run(
            Command::new("/bin/sh").args(["-c", "sleep 30"]),
            b"",
            Duration::from_secs(2),
            100,
            &cancel
        )
        .unwrap_err()
        .contains("closed"));
    }
    #[test]
    fn input_and_both_output_streams_are_drained() {
        let output = run(
            Command::new("/bin/sh").args(["-c", "cat; printf diagnostic >&2"]),
            b"request",
            Duration::from_secs(2),
            1024,
            &AtomicBool::new(false),
        )
        .unwrap();
        assert!(output.status.success());
        assert_eq!(output.stdout, b"request");
        assert_eq!(output.stderr, b"diagnostic");
    }
}
