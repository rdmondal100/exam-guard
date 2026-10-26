//! When the helper reports and takes a screenshot (architecture §3). Pure: the caller says what the
//! foreground window is, whether it counts as inside the exam, and what time it is.
//!
//! Outside = the foreground window is not the exam app (or one of its children). A switch to an
//! outside window, a title change of the outside window and a timer while the student stays outside
//! can each take a screenshot, at most one per `min_shot_gap`.

use std::time::{Duration, Instant};

use crate::pipe_msg::MonitorPolicy;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Window {
    pub pid: u32,
    /// File name of the program, for example `chrome.exe`.
    pub exe: String,
    pub path: String,
    pub title: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    FocusLost,
    FocusReturned,
    TitleChanged,
    /// The periodic shot while the student is still away.
    StillOutside,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::FocusLost => "focus_lost",
            Kind::FocusReturned => "focus_returned",
            Kind::TitleChanged => "title_changed",
            Kind::StillOutside => "still_outside",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Observation {
    pub kind: Kind,
    /// The outside window the observation is about (for `FocusReturned`: the one that was left).
    pub window: Window,
    /// `FocusReturned`: how long the student was outside.
    pub duration_ms: Option<u64>,
    /// Take a screenshot now.
    pub shot: bool,
}

pub struct Tracker {
    on_switch: bool,
    on_title: bool,
    periodic: Option<Duration>,
    min_gap: Duration,
    outside_since: Option<Instant>,
    window: Option<Window>,
    last_shot: Option<Instant>,
}

impl Tracker {
    pub fn new(policy: &MonitorPolicy) -> Self {
        Self {
            on_switch: policy.screenshot_on_switch,
            on_title: policy.title_change_shots,
            periodic: (policy.periodic_outside_sec > 0)
                .then(|| Duration::from_secs(u64::from(policy.periodic_outside_sec))),
            min_gap: Duration::from_secs(u64::from(policy.min_shot_gap_sec)),
            outside_since: None,
            window: None,
            last_shot: None,
        }
    }

    /// The foreground window changed (also used once at the start with the current one).
    pub fn foreground(&mut self, now: Instant, window: Window, inside: bool) -> Vec<Observation> {
        if inside {
            return self.returned(now).into_iter().collect();
        }
        if self.window.as_ref().is_some_and(|known| *known == window) {
            return Vec::new();
        }
        self.outside_since.get_or_insert(now);
        self.window = Some(window.clone());
        let shot = self.allow_shot(now, self.on_switch);
        vec![Observation {
            kind: Kind::FocusLost,
            window,
            duration_ms: None,
            shot,
        }]
    }

    /// The title of the foreground window changed. Only counts while the student is outside.
    pub fn title(&mut self, now: Instant, window: Window) -> Vec<Observation> {
        let Some(current) = &self.window else {
            return Vec::new();
        };
        if current.pid != window.pid || current.title == window.title {
            return Vec::new();
        }
        self.window = Some(window.clone());
        let shot = self.allow_shot(now, self.on_title);
        vec![Observation {
            kind: Kind::TitleChanged,
            window,
            duration_ms: None,
            shot,
        }]
    }

    /// Call a few times a second. Gives the periodic shot while the student stays outside.
    pub fn tick(&mut self, now: Instant) -> Vec<Observation> {
        let (Some(every), Some(since), Some(window)) =
            (self.periodic, self.outside_since, self.window.clone())
        else {
            return Vec::new();
        };
        let base = self.last_shot.map_or(since, |shot| shot.max(since));
        if now.duration_since(base) < every || !self.allow_shot(now, true) {
            return Vec::new();
        }
        vec![Observation {
            kind: Kind::StillOutside,
            window,
            duration_ms: None,
            shot: true,
        }]
    }

    fn returned(&mut self, now: Instant) -> Option<Observation> {
        let since = self.outside_since.take()?;
        let window = self.window.take()?;
        Some(Observation {
            kind: Kind::FocusReturned,
            window,
            duration_ms: Some(u64::try_from(now.duration_since(since).as_millis()).unwrap_or(0)),
            shot: false,
        })
    }

    /// Whether a screenshot may be taken now; remembers it when so.
    fn allow_shot(&mut self, now: Instant, wanted: bool) -> bool {
        if !wanted
            || self
                .last_shot
                .is_some_and(|last| now.duration_since(last) < self.min_gap)
        {
            return false;
        }
        self.last_shot = Some(now);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy() -> MonitorPolicy {
        MonitorPolicy {
            screenshot_on_switch: true,
            title_change_shots: true,
            periodic_outside_sec: 20,
            min_shot_gap_sec: 5,
            max_width: 1600,
            jpeg_quality: 60,
        }
    }

    fn window(pid: u32, exe: &str, title: &str) -> Window {
        Window {
            pid,
            exe: exe.into(),
            path: format!(r"C:\apps\{exe}"),
            title: title.into(),
        }
    }

    fn secs(t0: Instant, s: u64) -> Instant {
        t0 + Duration::from_secs(s)
    }

    #[test]
    fn a_switch_to_another_app_is_a_focus_lost_with_a_shot() {
        let t0 = Instant::now();
        let mut tracker = Tracker::new(&policy());
        let seen = tracker.foreground(t0, window(7, "chrome.exe", "Google"), false);
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].kind, Kind::FocusLost);
        assert_eq!(seen[0].window.exe, "chrome.exe");
        assert!(seen[0].shot);
    }

    #[test]
    fn staying_inside_reports_nothing() {
        let mut tracker = Tracker::new(&policy());
        let seen = tracker.foreground(Instant::now(), window(1, "exam.exe", "ExamGuard"), true);
        assert!(seen.is_empty());
    }

    #[test]
    fn returning_reports_how_long_the_student_was_away() {
        let t0 = Instant::now();
        let mut tracker = Tracker::new(&policy());
        tracker.foreground(t0, window(7, "chrome.exe", "Google"), false);
        let seen = tracker.foreground(secs(t0, 12), window(1, "exam.exe", "ExamGuard"), true);
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].kind, Kind::FocusReturned);
        assert_eq!(seen[0].duration_ms, Some(12_000));
        assert_eq!(seen[0].window.exe, "chrome.exe");
        assert!(!seen[0].shot);
        // Back inside: another inside event is not a second return.
        assert!(tracker
            .foreground(secs(t0, 13), window(1, "exam.exe", "ExamGuard"), true)
            .is_empty());
    }

    #[test]
    fn the_total_counts_from_the_first_outside_window_across_app_switches() {
        let t0 = Instant::now();
        let mut tracker = Tracker::new(&policy());
        tracker.foreground(t0, window(7, "chrome.exe", "Google"), false);
        let second = tracker.foreground(secs(t0, 4), window(8, "notepad.exe", "x"), false);
        assert_eq!(second[0].kind, Kind::FocusLost);
        assert!(!second[0].shot, "4 s after the last shot is inside the gap");
        let back = tracker.foreground(secs(t0, 10), window(1, "exam.exe", "ExamGuard"), true);
        assert_eq!(back[0].duration_ms, Some(10_000));
        assert_eq!(back[0].window.exe, "notepad.exe");
    }

    #[test]
    fn the_same_outside_window_twice_is_one_focus_lost() {
        let t0 = Instant::now();
        let mut tracker = Tracker::new(&policy());
        let chrome = window(7, "chrome.exe", "Google");
        assert_eq!(tracker.foreground(t0, chrome.clone(), false).len(), 1);
        assert!(tracker.foreground(secs(t0, 1), chrome, false).is_empty());
    }

    #[test]
    fn a_title_change_outside_takes_a_shot_after_the_gap() {
        let t0 = Instant::now();
        let mut tracker = Tracker::new(&policy());
        tracker.foreground(t0, window(7, "chrome.exe", "Google"), false);
        let early = tracker.title(secs(t0, 2), window(7, "chrome.exe", "Search"));
        assert_eq!(early[0].kind, Kind::TitleChanged);
        assert!(!early[0].shot, "2 s after the switch shot");
        let later = tracker.title(secs(t0, 8), window(7, "chrome.exe", "Mail"));
        assert!(later[0].shot);
        assert_eq!(later[0].window.title, "Mail");
    }

    #[test]
    fn a_title_change_that_changes_nothing_or_happens_inside_is_ignored() {
        let t0 = Instant::now();
        let mut tracker = Tracker::new(&policy());
        // Inside: no outside window is known.
        assert!(tracker
            .title(t0, window(1, "exam.exe", "ExamGuard - Q2"))
            .is_empty());
        tracker.foreground(t0, window(7, "chrome.exe", "Google"), false);
        assert!(tracker
            .title(secs(t0, 9), window(7, "chrome.exe", "Google"))
            .is_empty());
        // Another process's title is not the outside window's.
        assert!(tracker
            .title(secs(t0, 9), window(9, "other.exe", "Different"))
            .is_empty());
    }

    #[test]
    fn staying_outside_gives_a_shot_every_period() {
        let t0 = Instant::now();
        let mut tracker = Tracker::new(&policy());
        tracker.foreground(t0, window(7, "chrome.exe", "Google"), false);
        assert!(tracker.tick(secs(t0, 19)).is_empty());
        let first = tracker.tick(secs(t0, 20));
        assert_eq!(first[0].kind, Kind::StillOutside);
        assert!(first[0].shot);
        assert!(tracker.tick(secs(t0, 39)).is_empty());
        assert_eq!(tracker.tick(secs(t0, 40)).len(), 1);
    }

    #[test]
    fn a_title_shot_restarts_the_period() {
        let t0 = Instant::now();
        let mut tracker = Tracker::new(&policy());
        tracker.foreground(t0, window(7, "chrome.exe", "Google"), false);
        tracker.title(secs(t0, 15), window(7, "chrome.exe", "Mail"));
        assert!(tracker.tick(secs(t0, 20)).is_empty());
        assert_eq!(tracker.tick(secs(t0, 35)).len(), 1);
    }

    #[test]
    fn nothing_ticks_while_inside_or_when_the_period_is_off() {
        let t0 = Instant::now();
        let mut tracker = Tracker::new(&policy());
        assert!(tracker.tick(secs(t0, 100)).is_empty());
        let mut off = Tracker::new(&MonitorPolicy {
            periodic_outside_sec: 0,
            ..policy()
        });
        off.foreground(t0, window(7, "chrome.exe", "Google"), false);
        assert!(off.tick(secs(t0, 100)).is_empty());
    }

    #[test]
    fn switch_shots_can_be_turned_off_and_events_still_come() {
        let t0 = Instant::now();
        let mut tracker = Tracker::new(&MonitorPolicy {
            screenshot_on_switch: false,
            title_change_shots: false,
            ..policy()
        });
        let seen = tracker.foreground(t0, window(7, "chrome.exe", "Google"), false);
        assert_eq!(seen[0].kind, Kind::FocusLost);
        assert!(!seen[0].shot);
        let title = tracker.title(secs(t0, 30), window(7, "chrome.exe", "Mail"));
        assert!(!title[0].shot);
    }

    #[test]
    fn forty_five_seconds_in_chrome_with_one_tab_change_give_three_shots() {
        let t0 = Instant::now();
        let mut tracker = Tracker::new(&policy());
        let mut shots = 0;
        let mut count = |seen: Vec<Observation>| shots += seen.iter().filter(|o| o.shot).count();
        count(tracker.foreground(t0, window(7, "chrome.exe", "Google"), false));
        count(tracker.title(secs(t0, 10), window(7, "chrome.exe", "News")));
        for s in 1..=45 {
            count(tracker.tick(secs(t0, s)));
        }
        // switch at 0, title at 10, periodic at 30 (20 s after the title shot) and at 50 is past the end
        assert_eq!(shots, 3);
    }
}
