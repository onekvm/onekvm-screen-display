//! Axis-locked system gestures. Observe edge contacts before claiming them,
//! so ordinary taps and vertical list drags still reach the app.

use std::time::{Duration, Instant};

pub const HOME_CONFIRM_WINDOW: Duration = Duration::from_secs(2);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Back,
    Home,
}

#[derive(Default)]
pub struct Navigation {
    contact: Option<Contact>,
    home_until: Option<Instant>,
}

struct Contact {
    start: (i32, i32),
    last: (i32, i32),
    edge: Option<Action>,
    claimed: bool,
}

impl Navigation {
    /// A separate released swipe must confirm Home within the visible hint.
    /// Other app hints must not accidentally arm this destructive navigation.
    pub fn confirm_home(&mut self, now: Instant) -> bool {
        if self.home_until.take().is_some_and(|until| now < until) {
            true
        } else {
            self.home_until = Some(now + HOME_CONFIRM_WINDOW);
            false
        }
    }

    /// Returns (capture guest contact, committed action). A claimed contact
    /// must be CANCELLED in the guest, not synthesized as a tap/release.
    pub fn step(&mut self, point: Option<(i32, i32)>, height: i32) -> (bool, Option<Action>) {
        const SLOP: i32 = 12;
        const COMMIT: i32 = 28;
        if let Some(point) = point {
            let contact = self.contact.get_or_insert_with(|| Contact {
                start: point,
                last: point,
                // Reserve the pill strip, not the lower third of a 172px
                // screen. List rows and the slider start outside these edges.
                edge: if point.1 >= height.saturating_sub(20) {
                    Some(Action::Home)
                } else if point.0 < 20 {
                    Some(Action::Back)
                } else {
                    None
                },
                claimed: false,
            });
            contact.last = point;
            let dx = point.0 - contact.start.0;
            let up = contact.start.1 - point.1;
            if !contact.claimed && dx.abs().max(up.abs()) > SLOP {
                contact.claimed = match contact.edge {
                    Some(Action::Back) => dx > SLOP && dx > up.abs(),
                    Some(Action::Home) => up > SLOP && up > dx.abs(),
                    None => false,
                };
                if !contact.claimed {
                    // Once another axis wins, never steal a list drag later.
                    contact.edge = None;
                }
            }
            return (contact.claimed, None);
        }
        let Some(contact) = self.contact.take() else {
            return (false, None);
        };
        let dx = contact.last.0 - contact.start.0;
        let up = contact.start.1 - contact.last.1;
        let committed = contact.claimed
            && match contact.edge {
                Some(Action::Back) => dx >= COMMIT && dx > up.abs(),
                Some(Action::Home) => up >= COMMIT && up > dx.abs(),
                None => false,
            };
        let action = committed.then_some(contact.edge).flatten();
        if action == Some(Action::Back) {
            self.home_until = None;
        }
        (contact.claimed, action)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn home_requires_two_separate_swipes_within_hint_window() {
        let mut nav = Navigation::default();
        let now = Instant::now();
        for (delay, expected) in [
            (0, false),
            (500, true),
            (600, false),
            (2600, false),
            (2800, true),
        ] {
            nav.step(Some((160, 166)), 172);
            nav.step(Some((160, 110)), 172);
            assert_eq!(nav.step(None, 172).1, Some(Action::Home));
            assert_eq!(
                nav.confirm_home(now + Duration::from_millis(delay)),
                expected
            );
            assert_eq!(nav.step(None, 172), (false, None));
        }
    }

    #[test]
    fn back_resets_home_confirmation() {
        let mut nav = Navigation::default();
        let now = Instant::now();
        assert!(!nav.confirm_home(now));
        nav.step(Some((8, 60)), 172);
        nav.step(Some((70, 60)), 172);
        assert_eq!(nav.step(None, 172).1, Some(Action::Back));
        assert!(!nav.confirm_home(now + Duration::from_millis(200)));
    }

    #[test]
    fn pill_swipe_commits_once_on_release() {
        let mut nav = Navigation::default();
        assert_eq!(nav.step(Some((160, 166)), 172), (false, None));
        assert_eq!(nav.step(Some((160, 145)), 172), (true, None));
        assert_eq!(nav.step(Some((160, 116)), 172), (true, None));
        assert_eq!(nav.step(None, 172), (true, Some(Action::Home)));
        assert_eq!(nav.step(None, 172), (false, None));
    }

    #[test]
    fn right_swipe_commits_back_but_left_edge_tap_does_not() {
        let mut nav = Navigation::default();
        assert_eq!(nav.step(Some((8, 60)), 172), (false, None));
        assert_eq!(nav.step(None, 172), (false, None));
        nav.step(Some((8, 60)), 172);
        assert_eq!(nav.step(Some((56, 64)), 172), (true, None));
        assert_eq!(nav.step(None, 172), (true, Some(Action::Back)));
    }

    #[test]
    fn vertical_edge_drag_stays_with_guest() {
        let mut nav = Navigation::default();
        nav.step(Some((8, 80)), 172);
        assert_eq!(nav.step(Some((12, 45)), 172), (false, None));
        assert_eq!(nav.step(Some((70, 45)), 172), (false, None));
        assert_eq!(nav.step(None, 172), (false, None));
    }

    #[test]
    fn lower_list_rows_and_slider_do_not_become_system_gestures() {
        let mut nav = Navigation::default();
        nav.step(Some((160, 140)), 172);
        assert_eq!(nav.step(Some((160, 80)), 172), (false, None));
        assert_eq!(nav.step(None, 172), (false, None));
        nav.step(Some((24, 80)), 172);
        assert_eq!(nav.step(Some((100, 80)), 172), (false, None));
        assert_eq!(nav.step(None, 172), (false, None));
    }

    #[test]
    fn short_or_reversed_gesture_does_not_navigate() {
        let mut nav = Navigation::default();
        nav.step(Some((8, 60)), 172);
        nav.step(Some((25, 60)), 172);
        assert_eq!(nav.step(None, 172), (true, None));
        nav.step(Some((160, 166)), 172);
        nav.step(Some((160, 120)), 172);
        nav.step(Some((160, 162)), 172);
        assert_eq!(nav.step(None, 172), (true, None));
    }
}
