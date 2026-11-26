//! Generation-counted notifications: a change between drawing and waiting
//! must not be lost, including when several workers wait on the same signal.

use std::sync::{Condvar, Mutex};
use std::time::Duration;

#[derive(Default)]
pub struct Wake {
    generation: Mutex<u64>,
    changed: Condvar,
}

impl Wake {
    pub fn generation(&self) -> u64 {
        *self.generation.lock().unwrap()
    }

    pub fn notify(&self) {
        let mut generation = self.generation.lock().unwrap();
        *generation = generation.wrapping_add(1);
        self.changed.notify_all();
    }

    pub fn wait(&self, seen: u64, timeout: Option<Duration>) {
        let generation = self.generation.lock().unwrap();
        if let Some(timeout) = timeout {
            let _guard = self
                .changed
                .wait_timeout_while(generation, timeout, |n| *n == seen)
                .unwrap();
        } else {
            let _guard = self.changed.wait_while(generation, |n| *n == seen).unwrap();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{mpsc, Arc};

    #[test]
    fn change_before_wait_is_not_lost() {
        let wake = Arc::new(Wake::default());
        let seen = wake.generation();
        wake.notify();
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            wake.wait(seen, None);
            tx.send(()).unwrap();
        });
        rx.recv_timeout(Duration::from_secs(1)).unwrap();
    }

    #[test]
    fn one_change_wakes_all_workers() {
        let wake = Arc::new(Wake::default());
        let seen = wake.generation();
        let (tx, rx) = mpsc::channel();
        for _ in 0..3 {
            let wake = wake.clone();
            let tx = tx.clone();
            std::thread::spawn(move || {
                wake.wait(seen, None);
                tx.send(()).unwrap();
            });
        }
        wake.notify();
        for _ in 0..3 {
            rx.recv_timeout(Duration::from_secs(1)).unwrap();
        }
    }
}
