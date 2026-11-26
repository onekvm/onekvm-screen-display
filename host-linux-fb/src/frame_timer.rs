//! One pending guest redraw, without keeping an idle guest running.
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

#[derive(Default)]
pub struct FrameTimer(Mutex<Option<Instant>>);

impl FrameTimer {
    pub fn schedule(&self, delay: Duration) {
        *self.0.lock().unwrap() = Some(Instant::now() + delay);
    }

    pub fn schedule_earlier(&self, delay: Duration) {
        let next = Instant::now() + delay;
        let mut deadline = self.0.lock().unwrap();
        if deadline.is_none_or(|current| next < current) { *deadline = Some(next); }
    }

    pub fn clear(&self) {
        *self.0.lock().unwrap() = None;
    }

    pub fn deadline(&self) -> Option<Instant> {
        *self.0.lock().unwrap()
    }

    pub fn take_due(&self) -> bool {
        self.take_due_at(Instant::now())
    }

    fn take_due_at(&self, now: Instant) -> bool {
        let mut deadline = self.0.lock().unwrap();
        if deadline.is_some_and(|at| now >= at) {
            *deadline = None;
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redraw_is_delayed_and_consumed_once() {
        let timer = FrameTimer::default();
        timer.schedule(Duration::from_secs(5));
        let at = timer.deadline().unwrap();
        assert!(!timer.take_due_at(at - Duration::from_millis(1)));
        assert!(timer.take_due_at(at));
        assert!(!timer.take_due_at(at + Duration::from_secs(1)));
        assert!(timer.deadline().is_none());
    }

    #[test]
    fn new_input_extends_the_deadline_and_app_changes_cancel_it() {
        let timer = FrameTimer::default();
        timer.schedule(Duration::from_secs(1));
        let old = timer.deadline().unwrap();
        timer.schedule(Duration::from_secs(5));
        assert!(!timer.take_due_at(old));
        timer.clear();
        assert!(!timer.take_due_at(old + Duration::from_secs(10)));
    }
}
