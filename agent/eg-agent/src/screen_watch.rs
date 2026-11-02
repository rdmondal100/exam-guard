//! Screens and the secure desktop while monitoring is on: a second monitor (at the start, or plugged
//! in later) and Ctrl+Alt+Del / lock screen / UAC prompt. Pure: the caller polls Windows and passes
//! what it saw with the time; this says what to report.

use std::time::{Duration, Instant};

use crate::desktop::InputDesktop;
use crate::pipe_msg::EvidenceData;

/// A new monitor count must be seen this many polls in a row (500 ms apart) before it counts:
/// Windows passes through odd counts while it rearranges the displays.
const STABLE_POLLS: u32 = 2;
/// At most one `secure_desktop` this often, so locking and unlocking in a loop cannot flood.
const SECURE_GAP: Duration = Duration::from_secs(5);
const MAX_DESKTOP_CHARS: usize = 64;

/// One thing to report.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScreenEvent {
    pub kind: &'static str,
    pub data: EvidenceData,
    /// Take a screenshot with it (a new screen: show what is on it).
    pub shot: bool,
}

#[derive(Default)]
pub struct ScreenWatch {
    /// The count reported last; `None` before the first look.
    monitors: Option<u32>,
    /// A different count and how many polls in a row it was seen.
    pending: Option<(u32, u32)>,
    secure: bool,
    last_secure: Option<Instant>,
}

impl ScreenWatch {
    pub fn observe(
        &mut self,
        now: Instant,
        monitors: u32,
        desktop: &InputDesktop,
    ) -> Vec<ScreenEvent> {
        let mut seen = Vec::new();
        if let Some(event) = self.monitors(monitors) {
            seen.push(event);
        }
        if let Some(event) = self.desktop(now, desktop) {
            seen.push(event);
        }
        seen
    }

    fn monitors(&mut self, count: u32) -> Option<ScreenEvent> {
        // 0 is a passing state while displays change (or no display at all); never report it.
        if count == 0 {
            return None;
        }
        let Some(current) = self.monitors else {
            self.monitors = Some(count);
            return (count > 1).then(|| monitor_event(count, None));
        };
        if count == current {
            self.pending = None;
            return None;
        }
        let polls = match self.pending {
            Some((pending, polls)) if pending == count => polls + 1,
            _ => 1,
        };
        if polls < STABLE_POLLS {
            self.pending = Some((count, polls));
            return None;
        }
        self.pending = None;
        self.monitors = Some(count);
        Some(monitor_event(count, Some(current)))
    }

    fn desktop(&mut self, now: Instant, desktop: &InputDesktop) -> Option<ScreenEvent> {
        let secure = matches!(desktop, InputDesktop::Other(_));
        let entered = secure && !self.secure;
        self.secure = secure;
        if !entered {
            return None;
        }
        if self
            .last_secure
            .is_some_and(|last| now.duration_since(last) < SECURE_GAP)
        {
            return None;
        }
        self.last_secure = Some(now);
        let name = match desktop {
            InputDesktop::Other(Some(name)) => Some(name.chars().take(MAX_DESKTOP_CHARS).collect()),
            _ => None,
        };
        Some(ScreenEvent {
            kind: "secure_desktop",
            data: EvidenceData {
                desktop: name,
                ..EvidenceData::default()
            },
            // A capture of the student's desktop cannot see the secure one.
            shot: false,
        })
    }
}

fn monitor_event(monitors: u32, before: Option<u32>) -> ScreenEvent {
    ScreenEvent {
        kind: "monitor_changed",
        data: EvidenceData {
            monitors: Some(monitors),
            monitors_before: before,
            ..EvidenceData::default()
        },
        shot: before.is_none_or(|before| monitors > before),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DEFAULT: InputDesktop = InputDesktop::Default;

    fn winlogon() -> InputDesktop {
        InputDesktop::Other(Some("Winlogon".into()))
    }

    fn kinds(events: &[ScreenEvent]) -> Vec<&'static str> {
        events.iter().map(|e| e.kind).collect()
    }

    #[test]
    fn one_screen_at_the_start_is_not_reported_and_two_are() {
        let now = Instant::now();
        assert!(ScreenWatch::default().observe(now, 1, &DEFAULT).is_empty());
        let events = ScreenWatch::default().observe(now, 2, &DEFAULT);
        assert_eq!(kinds(&events), vec!["monitor_changed"]);
        assert_eq!(events[0].data.monitors, Some(2));
        assert_eq!(events[0].data.monitors_before, None);
        assert!(events[0].shot);
    }

    #[test]
    fn a_plugged_in_screen_counts_once_it_is_seen_twice_and_takes_a_picture() {
        let mut watch = ScreenWatch::default();
        let now = Instant::now();
        watch.observe(now, 1, &DEFAULT);
        assert!(watch.observe(now, 2, &DEFAULT).is_empty());
        let events = watch.observe(now, 2, &DEFAULT);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].data.monitors, Some(2));
        assert_eq!(events[0].data.monitors_before, Some(1));
        assert!(events[0].shot);
        // Reported once.
        assert!(watch.observe(now, 2, &DEFAULT).is_empty());
    }

    #[test]
    fn a_short_flicker_and_a_zero_count_are_ignored() {
        let mut watch = ScreenWatch::default();
        let now = Instant::now();
        watch.observe(now, 1, &DEFAULT);
        assert!(watch.observe(now, 3, &DEFAULT).is_empty());
        assert!(watch.observe(now, 1, &DEFAULT).is_empty());
        assert!(watch.observe(now, 0, &DEFAULT).is_empty());
        assert!(watch.observe(now, 0, &DEFAULT).is_empty());
        assert!(watch.observe(now, 1, &DEFAULT).is_empty());
    }

    #[test]
    fn an_unplugged_screen_is_reported_without_a_picture() {
        let mut watch = ScreenWatch::default();
        let now = Instant::now();
        watch.observe(now, 2, &DEFAULT);
        watch.observe(now, 1, &DEFAULT);
        let events = watch.observe(now, 1, &DEFAULT);
        assert_eq!(events[0].data.monitors, Some(1));
        assert_eq!(events[0].data.monitors_before, Some(2));
        assert!(!events[0].shot);
    }

    #[test]
    fn the_secure_desktop_is_reported_when_it_comes_up_with_its_name() {
        let mut watch = ScreenWatch::default();
        let now = Instant::now();
        watch.observe(now, 1, &DEFAULT);
        let events = watch.observe(now, 1, &winlogon());
        assert_eq!(kinds(&events), vec!["secure_desktop"]);
        assert_eq!(events[0].data.desktop.as_deref(), Some("Winlogon"));
        assert!(!events[0].shot);
        // Staying there is one event.
        assert!(watch.observe(now, 1, &winlogon()).is_empty());
    }

    #[test]
    fn a_desktop_we_may_not_open_is_reported_without_a_name() {
        let mut watch = ScreenWatch::default();
        let events = watch.observe(Instant::now(), 1, &InputDesktop::Other(None));
        assert_eq!(kinds(&events), vec!["secure_desktop"]);
        assert_eq!(events[0].data.desktop, None);
    }

    #[test]
    fn going_back_and_forth_reports_at_most_once_per_gap() {
        let mut watch = ScreenWatch::default();
        let start = Instant::now();
        assert_eq!(watch.observe(start, 1, &winlogon()).len(), 1);
        watch.observe(start, 1, &DEFAULT);
        assert!(watch
            .observe(start + Duration::from_secs(2), 1, &winlogon())
            .is_empty());
        watch.observe(start + Duration::from_secs(3), 1, &DEFAULT);
        assert_eq!(
            watch
                .observe(start + Duration::from_secs(6), 1, &winlogon())
                .len(),
            1
        );
    }
}
