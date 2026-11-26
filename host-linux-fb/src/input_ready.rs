//! Notify the renderer once per readable input batch, without an idle timer.

use std::io;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;

struct State {
    armed: bool,
    stopped: bool,
    failed: bool,
}

pub struct InputReady {
    state: Arc<(Mutex<State>, Condvar)>,
    stop: Arc<OwnedFd>,
    worker: Option<JoinHandle<()>>,
}

impl InputReady {
    pub fn new(fd: RawFd, notify: impl Fn() + Send + 'static) -> io::Result<Self> {
        // The duplicate shares readiness but is never read by this worker.
        let raw = unsafe { libc::fcntl(fd, libc::F_DUPFD_CLOEXEC, 0) };
        if raw < 0 {
            return Err(io::Error::last_os_error());
        }
        let input = unsafe { OwnedFd::from_raw_fd(raw) };
        let raw = unsafe { libc::eventfd(0, libc::EFD_CLOEXEC | libc::EFD_NONBLOCK) };
        if raw < 0 {
            return Err(io::Error::last_os_error());
        }
        let stop = Arc::new(unsafe { OwnedFd::from_raw_fd(raw) });
        let state = Arc::new((
            Mutex::new(State {
                armed: true,
                stopped: false,
                failed: false,
            }),
            Condvar::new(),
        ));
        let control = Arc::clone(&state);
        let stop_fd = Arc::clone(&stop);
        let worker = std::thread::Builder::new()
            .name("screen-touch".into())
            .spawn(move || loop {
                let (lock, changed) = &*control;
                let current = lock.lock().unwrap();
                let mut current = changed
                    .wait_while(current, |s| !s.armed && !s.stopped)
                    .unwrap();
                if current.stopped {
                    return;
                }
                drop(current);
                let mut fds = [
                    libc::pollfd {
                        fd: input.as_raw_fd(),
                        events: libc::POLLIN,
                        revents: 0,
                    },
                    libc::pollfd {
                        fd: stop_fd.as_raw_fd(),
                        events: libc::POLLIN,
                        revents: 0,
                    },
                ];
                let ready = unsafe { libc::poll(fds.as_mut_ptr(), fds.len() as _, -1) };
                if ready < 0 && io::Error::last_os_error().kind() == io::ErrorKind::Interrupted {
                    continue;
                }
                if fds[1].revents != 0 {
                    return;
                }
                current = lock.lock().unwrap();
                current.armed = false;
                if ready < 0
                    || fds[0].revents & (libc::POLLERR | libc::POLLHUP | libc::POLLNVAL) != 0
                {
                    current.failed = true;
                    drop(current);
                    notify();
                    return;
                }
                drop(current);
                notify();
            })?;
        Ok(Self {
            state,
            stop,
            worker: Some(worker),
        })
    }

    pub fn rearm(&self) {
        let (state, changed) = &*self.state;
        state.lock().unwrap().armed = true;
        changed.notify_one();
    }

    pub fn failed(&self) -> bool {
        self.state.0.lock().unwrap().failed
    }
}

impl Drop for InputReady {
    fn drop(&mut self) {
        self.state.0.lock().unwrap().stopped = true;
        self.state.1.notify_all();
        let value = 1u64;
        unsafe {
            libc::write(self.stop.as_raw_fd(), (&value as *const u64).cast(), 8);
        }
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::os::unix::net::UnixStream;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn blocks_until_input_and_requires_consumption_before_rearming() {
        let (mut input, mut writer) = UnixStream::pair().unwrap();
        let (tx, rx) = mpsc::channel();
        let ready = InputReady::new(input.as_raw_fd(), move || {
            let _ = tx.send(());
        })
        .unwrap();
        assert!(rx.recv_timeout(Duration::from_millis(30)).is_err());
        writer.write_all(b"press").unwrap();
        rx.recv_timeout(Duration::from_secs(1)).unwrap();
        assert!(rx.recv_timeout(Duration::from_millis(30)).is_err());
        let mut bytes = [0; 5];
        input.read_exact(&mut bytes).unwrap();
        ready.rearm();
        writer.write_all(b"up").unwrap();
        rx.recv_timeout(Duration::from_secs(1)).unwrap();
        assert!(!ready.failed());
        // Drop must also join a worker parked awaiting consumption.
        drop(ready);
    }

    #[test]
    fn removal_wakes_once_and_allows_a_polling_fallback() {
        let (input, writer) = UnixStream::pair().unwrap();
        let (tx, rx) = mpsc::channel();
        let ready = InputReady::new(input.as_raw_fd(), move || {
            let _ = tx.send(());
        })
        .unwrap();
        drop(writer);
        rx.recv_timeout(Duration::from_secs(1)).unwrap();
        assert!(ready.failed());
    }
}
