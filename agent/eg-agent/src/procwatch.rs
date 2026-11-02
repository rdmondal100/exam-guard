//! Reports the programs the student starts while monitoring is on (`app_launched`), and the ones
//! already running when it began (`processes_at_start`); Task Manager is `taskmgr_opened` (M26).
//! Runs in the service and puts its evidence
//! straight into the queue, so it needs neither the helper nor the foreground window.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::evidence_queue::EvidenceQueue;
use crate::pipe_msg::{EvidenceBody, EvidenceData, ProcessRef};
use crate::proc_snapshot::{self, Entry};
use crate::process_tree::is_descendant;
use crate::window_info::exe_path;

const POLL: Duration = Duration::from_secs(1);
/// How often the stop flag is looked at while waiting for the next poll.
const STOP_STEP: Duration = Duration::from_millis(100);
/// Most programs `processes_at_start` lists (the shared schema allows the same).
const MAX_LISTED: usize = 300;
/// More launches than this in a minute are dropped, so a loop cannot flood the exam's evidence.
const MAX_LAUNCHES_PER_MIN: usize = 60;
const MAX_EXE_CHARS: usize = 260;
const MAX_PATH_CHARS: usize = 520;

/// Windows' own helpers that every user session starts again and again. The classifier (M31) does
/// the real triage; these would only bury the list.
const IGNORED: &[&str] = &[
    "backgroundtaskhost.exe",
    "conhost.exe",
    "ctfmon.exe",
    "dllhost.exe",
    "searchprotocolhost.exe",
    "runtimebroker.exe",
    "smartscreen.exe",
    "taskhostw.exe",
    "wermgr.exe",
    "werfault.exe",
];

fn is_ignored(exe: &str) -> bool {
    IGNORED.iter().any(|name| name.eq_ignore_ascii_case(exe))
}

/// What is new since the last look. Pure: the caller supplies the list, the time and who owns what.
#[derive(Default)]
pub struct Tracker {
    known: HashSet<u32>,
    launches: VecDeque<Instant>,
}

impl Tracker {
    /// Remembers everything running and returns the user's programs among it.
    pub fn baseline(
        &mut self,
        list: &[Entry],
        mut is_user: impl FnMut(&Entry) -> bool,
    ) -> Vec<Entry> {
        self.known = list.iter().map(|entry| entry.pid).collect();
        list.iter()
            .filter(|entry| !is_ignored(&entry.exe) && is_user(entry))
            .cloned()
            .collect()
    }

    /// The user's programs that appeared since the last call, except the ignored helpers and
    /// anything the exam app started (`exam_pid` and its descendants).
    pub fn launched(
        &mut self,
        now: Instant,
        list: &[Entry],
        exam_pid: Option<u32>,
        mut is_user: impl FnMut(&Entry) -> bool,
    ) -> Vec<Entry> {
        let parents: HashMap<u32, u32> = list.iter().map(|e| (e.pid, e.parent)).collect();
        let mut fresh = Vec::new();
        for entry in list.iter().filter(|e| !self.known.contains(&e.pid)) {
            let ours = exam_pid.is_some_and(|exam| is_descendant(&parents, entry.pid, exam));
            if !ours && !is_ignored(&entry.exe) && is_user(entry) {
                fresh.push(entry.clone());
            }
        }
        // Ended processes drop out, so a reused id is new again.
        self.known = list.iter().map(|entry| entry.pid).collect();

        while self
            .launches
            .front()
            .is_some_and(|t| now.duration_since(*t) >= Duration::from_secs(60))
        {
            self.launches.pop_front();
        }
        let room = MAX_LAUNCHES_PER_MIN.saturating_sub(self.launches.len());
        if fresh.len() > room {
            tracing::warn!(
                dropped = fresh.len() - room,
                "too many programs started, not all reported"
            );
            fresh.truncate(room);
        }
        self.launches.extend(std::iter::repeat_n(now, fresh.len()));
        fresh
    }
}

fn unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(0))
}

fn cut(text: &str, max_chars: usize) -> String {
    text.chars().take(max_chars).collect()
}

/// The `processes_at_start` evidence.
pub fn start_body(ts: u64, running: &[Entry]) -> EvidenceBody {
    let processes = running
        .iter()
        .take(MAX_LISTED)
        .map(|entry| ProcessRef {
            exe: cut(&entry.exe, MAX_EXE_CHARS),
            pid: entry.pid,
        })
        .collect();
    EvidenceBody {
        ts,
        kind: "processes_at_start".into(),
        data: EvidenceData {
            processes: Some(processes),
            ..EvidenceData::default()
        },
        screenshot: None,
    }
}

/// Task Manager is its own event (M26, medium); every other program is an `app_launched`.
pub fn launch_kind(exe: &str) -> &'static str {
    if exe.eq_ignore_ascii_case("taskmgr.exe") {
        "taskmgr_opened"
    } else {
        "app_launched"
    }
}

/// The `app_launched` (or `taskmgr_opened`) evidence. `parent` is the starter's file name when it
/// is still running.
pub fn launch_body(
    ts: u64,
    entry: &Entry,
    path: Option<&str>,
    parent: Option<&str>,
) -> EvidenceBody {
    EvidenceBody {
        ts,
        kind: launch_kind(&entry.exe).into(),
        data: EvidenceData {
            exe: Some(cut(&entry.exe, MAX_EXE_CHARS)),
            path: path.map(|p| cut(p, MAX_PATH_CHARS)),
            pid: Some(entry.pid),
            parent_exe: parent.map(|p| cut(p, MAX_EXE_CHARS)),
            parent_pid: Some(entry.parent),
            ..EvidenceData::default()
        },
        screenshot: None,
    }
}

/// The polling thread. Dropping or `stop`ping it ends the thread.
pub struct ProcWatch {
    stop: Arc<AtomicBool>,
    exam_pid: Arc<AtomicU32>,
    thread: Option<JoinHandle<()>>,
}

impl ProcWatch {
    /// `session` says which session is the student's, asked again at every poll (a logoff and a new
    /// logon change it).
    pub fn start(evidence: Arc<EvidenceQueue>, session: fn() -> Option<u32>) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let exam_pid = Arc::new(AtomicU32::new(0));
        let thread = {
            let (stop, exam_pid) = (stop.clone(), exam_pid.clone());
            thread::spawn(move || watch(&evidence, session, &stop, &exam_pid))
        };
        Self {
            stop,
            exam_pid,
            thread: Some(thread),
        }
    }

    /// The exam app's process; what it starts is expected.
    pub fn set_exam_pid(&self, pid: u32) {
        self.exam_pid.store(pid, Ordering::SeqCst);
    }

    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(thread) = self.thread.take() {
            // The thread only panics on a bug; the log has it.
            let _ = thread.join();
        }
    }
}

impl Drop for ProcWatch {
    fn drop(&mut self) {
        self.stop();
    }
}

fn watch(
    evidence: &EvidenceQueue,
    session: fn() -> Option<u32>,
    stop: &AtomicBool,
    exam_pid: &AtomicU32,
) {
    let mut tracker = Tracker::default();
    let mut baseline_done = false;
    while !stop.load(Ordering::SeqCst) {
        // Without a logged-on user there is nobody to watch yet; the baseline waits for one.
        if let Some(session) = session() {
            let list = proc_snapshot::list();
            let is_user = |entry: &Entry| proc_snapshot::is_user_process(entry.pid, session);
            if baseline_done {
                let exam = Some(exam_pid.load(Ordering::SeqCst)).filter(|&pid| pid != 0);
                let names: HashMap<u32, &str> =
                    list.iter().map(|e| (e.pid, e.exe.as_str())).collect();
                for entry in tracker.launched(Instant::now(), &list, exam, is_user) {
                    let path = exe_path(entry.pid).ok();
                    let parent = names.get(&entry.parent).copied();
                    evidence.push(launch_body(unix_ms(), &entry, path.as_deref(), parent));
                }
            } else {
                let running = tracker.baseline(&list, is_user);
                tracing::info!(programs = running.len(), "process baseline taken");
                evidence.push(start_body(unix_ms(), &running));
                baseline_done = true;
            }
        }
        let mut waited = Duration::ZERO;
        while waited < POLL && !stop.load(Ordering::SeqCst) {
            thread::sleep(STOP_STEP);
            waited += STOP_STEP;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(pid: u32, parent: u32, exe: &str) -> Entry {
        Entry {
            pid,
            parent,
            exe: exe.into(),
        }
    }

    fn everyone(_: &Entry) -> bool {
        true
    }

    #[test]
    fn the_baseline_lists_the_users_programs_and_hides_windows_helpers() {
        let mut tracker = Tracker::default();
        let list = [
            entry(10, 1, "Spotify.exe"),
            entry(11, 1, "conhost.exe"),
            entry(12, 1, "svchost.exe"),
        ];
        let running = tracker.baseline(&list, |e| e.exe != "svchost.exe");
        let names: Vec<&str> = running.iter().map(|e| e.exe.as_str()).collect();
        assert_eq!(names, vec!["Spotify.exe"]);
    }

    #[test]
    fn only_programs_that_appear_after_the_baseline_are_launches() {
        let mut tracker = Tracker::default();
        let before = [entry(10, 1, "Spotify.exe")];
        tracker.baseline(&before, everyone);
        let now = Instant::now();
        assert!(tracker.launched(now, &before, None, everyone).is_empty());
        let after = [entry(10, 1, "Spotify.exe"), entry(20, 10, "notepad.exe")];
        let fresh = tracker.launched(now, &after, None, everyone);
        assert_eq!(fresh, vec![entry(20, 10, "notepad.exe")]);
        // Seen once, not reported again.
        assert!(tracker.launched(now, &after, None, everyone).is_empty());
    }

    #[test]
    fn a_reused_process_id_is_a_new_launch_once_the_old_one_ended() {
        let mut tracker = Tracker::default();
        let now = Instant::now();
        tracker.baseline(&[], everyone);
        let first = [entry(20, 1, "notepad.exe")];
        assert_eq!(tracker.launched(now, &first, None, everyone).len(), 1);
        assert!(tracker.launched(now, &[], None, everyone).is_empty());
        assert_eq!(tracker.launched(now, &first, None, everyone).len(), 1);
    }

    #[test]
    fn what_the_exam_app_starts_is_expected() {
        let mut tracker = Tracker::default();
        let now = Instant::now();
        tracker.baseline(&[entry(5, 1, "ExamGuard.exe")], everyone);
        let list = [
            entry(5, 1, "ExamGuard.exe"),
            entry(6, 5, "eg-runner.exe"),
            entry(7, 6, "a.exe"),
            entry(8, 1, "notepad.exe"),
        ];
        let fresh = tracker.launched(now, &list, Some(5), everyone);
        assert_eq!(fresh, vec![entry(8, 1, "notepad.exe")]);
    }

    #[test]
    fn windows_background_hosts_and_other_accounts_are_not_launches() {
        let mut tracker = Tracker::default();
        tracker.baseline(&[], everyone);
        let list = [
            entry(1, 0, "RuntimeBroker.exe"),
            entry(2, 0, "svchost.exe"),
            entry(3, 0, "chrome.exe"),
        ];
        let fresh = tracker.launched(Instant::now(), &list, None, |e| e.exe != "svchost.exe");
        assert_eq!(fresh, vec![entry(3, 0, "chrome.exe")]);
    }

    #[test]
    fn a_flood_of_launches_is_cut_at_the_per_minute_cap() {
        let mut tracker = Tracker::default();
        tracker.baseline(&[], everyone);
        let start = Instant::now();
        let many: Vec<Entry> = (100..100 + 80).map(|pid| entry(pid, 1, "x.exe")).collect();
        assert_eq!(
            tracker.launched(start, &many, None, everyone).len(),
            MAX_LAUNCHES_PER_MIN
        );
        // A minute later the allowance is back.
        let more: Vec<Entry> = (500..510).map(|pid| entry(pid, 1, "x.exe")).collect();
        let later = start + Duration::from_secs(61);
        assert_eq!(tracker.launched(later, &more, None, everyone).len(), 10);
    }

    #[test]
    fn a_running_watch_reports_the_start_list_and_then_a_program_we_start() {
        let queue = Arc::new(EvidenceQueue::new(1));
        let mut watch = ProcWatch::start(queue.clone(), crate::session::current_session);
        let wait_for = |kind: &str| {
            for _ in 0..100 {
                if let Some(found) = queue.after(0).into_iter().find(|s| s.body.kind == kind) {
                    return found.body;
                }
                thread::sleep(Duration::from_millis(100));
            }
            panic!("no {kind} evidence in 10 s");
        };
        let start = wait_for("processes_at_start");
        let me = std::process::id();
        assert!(start
            .data
            .processes
            .is_some_and(|p| p.iter().any(|r| r.pid == me)));

        let mut child = std::process::Command::new("ping")
            .args(["-n", "6", "127.0.0.1"])
            .stdout(std::process::Stdio::null())
            .spawn()
            .expect("ping starts");
        let launch = wait_for("app_launched");
        child.kill().ok();
        child.wait().ok();
        watch.stop();
        assert_eq!(launch.data.pid, Some(child.id()));
        assert_eq!(launch.data.exe.as_deref(), Some("PING.EXE"));
        assert_eq!(launch.data.parent_pid, Some(me));
        assert!(launch
            .data
            .path
            .is_some_and(|p| p.to_lowercase().ends_with("ping.exe")));
    }

    #[test]
    fn task_manager_is_reported_as_its_own_kind() {
        assert_eq!(launch_kind("Taskmgr.exe"), "taskmgr_opened");
        assert_eq!(launch_kind("notepad.exe"), "app_launched");
        let body = launch_body(1, &entry(30, 4, "taskmgr.exe"), None, Some("winlogon.exe"));
        assert_eq!(body.kind, "taskmgr_opened");
        assert_eq!(body.data.exe.as_deref(), Some("taskmgr.exe"));
        assert_eq!(body.data.parent_exe.as_deref(), Some("winlogon.exe"));
    }

    #[test]
    fn evidence_bodies_carry_the_schema_fields_within_its_limits() {
        let long = "a".repeat(400);
        let launch = launch_body(
            7,
            &entry(20, 10, &long),
            Some(r"C:\x\notepad.exe"),
            Some("explorer.exe"),
        );
        assert_eq!(launch.kind, "app_launched");
        assert_eq!(
            launch.data.exe.as_ref().map(String::len),
            Some(MAX_EXE_CHARS)
        );
        assert_eq!(launch.data.parent_exe.as_deref(), Some("explorer.exe"));
        assert_eq!(launch.data.parent_pid, Some(10));

        let many: Vec<Entry> = (0..400).map(|pid| entry(pid, 1, "a.exe")).collect();
        let start = start_body(7, &many);
        assert_eq!(start.kind, "processes_at_start");
        assert_eq!(start.data.processes.map(|p| p.len()), Some(MAX_LISTED));
    }
}
