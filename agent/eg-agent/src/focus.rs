//! The helper's monitoring: watches which window is in front (foreground and title hooks plus a
//! timer on one message-loop thread), asks `policy::Tracker` what that means, and has a worker
//! thread take the screenshots and hand the evidence to the service link.
//!
//! Monitoring runs only when the service has sent both `monitor.start` and `exam.window`. Hook
//! callbacks must stay quick, so nothing slow (capture, JPEG, the pipe) happens in them.

use std::cell::RefCell;
use std::ptr::null_mut;
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use windows_sys::Win32::Foundation::HWND;
use windows_sys::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, GetForegroundWindow, GetMessageW, KillTimer, SetTimer, TranslateMessage,
    CHILDID_SELF, EVENT_OBJECT_NAMECHANGE, EVENT_SYSTEM_FOREGROUND, MSG, OBJID_WINDOW,
    WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS, WM_TIMER,
};

use crate::pipe_msg::{EvidenceBody, EvidenceData, FromHelper, MonitorPolicy, Screenshot};
use crate::policy::{Observation, Tracker, Window};
use crate::{capture, process_tree, window_info};

/// How often commands are picked up and the periodic screenshot is considered.
const TICK_MS: u32 = 250;
const MAX_TITLE_CHARS: usize = 500;
const MAX_EXE_CHARS: usize = 260;
const MAX_PATH_CHARS: usize = 520;

/// What the service tells the helper (`ToHelper` on the helper pipe).
#[derive(Debug)]
pub enum Command {
    Start(MonitorPolicy),
    Stop,
    ExamWindow { hwnd: u64, pid: u32 },
}

struct ExamWindow {
    hwnd: u64,
    pid: u32,
}

/// One observation waiting for its screenshot.
struct Job {
    ts: u64,
    observation: Observation,
    /// Width and JPEG quality when a screenshot is wanted.
    shot: Option<(u32, u8)>,
}

struct State {
    commands: Receiver<Command>,
    jobs: Sender<Job>,
    policy: Option<MonitorPolicy>,
    exam: Option<ExamWindow>,
    tracker: Option<Tracker>,
}

thread_local! {
    static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
}

fn unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(0))
}

fn truncate(text: &str, max_chars: usize) -> String {
    text.chars().take(max_chars).collect()
}

fn exe_name(path: &str) -> String {
    path.rsplit(['\\', '/']).next().unwrap_or(path).to_string()
}

fn window_of(hwnd: HWND) -> Option<Window> {
    let info = window_info::describe(hwnd);
    if info.pid == 0 {
        return None;
    }
    let path = info.exe.unwrap_or_default();
    Some(Window {
        pid: info.pid,
        exe: exe_name(&path),
        path,
        title: info.title,
    })
}

impl State {
    fn drain_commands(&mut self) {
        let mut changed = false;
        while let Ok(command) = self.commands.try_recv() {
            changed = true;
            match command {
                Command::Start(policy) => {
                    if self.policy.as_ref() != Some(&policy) {
                        self.tracker = None;
                    }
                    self.policy = Some(policy);
                }
                Command::Stop => {
                    self.policy = None;
                    self.tracker = None;
                }
                Command::ExamWindow { hwnd, pid } => self.exam = Some(ExamWindow { hwnd, pid }),
            }
        }
        if changed {
            self.refresh();
        }
    }

    /// Starts the tracker once it has both a policy and an exam window, and looks at the window that
    /// is in front right now.
    fn refresh(&mut self) {
        if self.policy.is_none() {
            self.tracker = None;
            return;
        }
        let (Some(policy), Some(exam), None) = (&self.policy, &self.exam, &self.tracker) else {
            return;
        };
        tracing::info!(exam_pid = exam.pid, "monitoring started");
        self.tracker = Some(Tracker::new(policy));
        // SAFETY: no arguments.
        let front = unsafe { GetForegroundWindow() };
        if !front.is_null() {
            self.on_foreground(front);
        }
    }

    fn is_inside(&self, hwnd: HWND, pid: u32) -> bool {
        let Some(exam) = &self.exam else { return true };
        hwnd as usize as u64 == exam.hwnd
            || pid == exam.pid
            || process_tree::is_descendant(&process_tree::parent_map(), pid, exam.pid)
    }

    fn on_foreground(&mut self, hwnd: HWND) {
        if self.tracker.is_none() {
            return;
        }
        let Some(window) = window_of(hwnd) else { return };
        let inside = self.is_inside(hwnd, window.pid);
        tracing::info!(pid = window.pid, exe = %window.exe, title = %window.title, inside, "foreground");
        let seen = self
            .tracker
            .as_mut()
            .map(|tracker| tracker.foreground(Instant::now(), window, inside))
            .unwrap_or_default();
        self.emit(seen);
    }

    fn on_title(&mut self, hwnd: HWND) {
        // SAFETY: no arguments.
        if self.tracker.is_none() || hwnd != unsafe { GetForegroundWindow() } {
            return;
        }
        let Some(window) = window_of(hwnd) else { return };
        let seen = self
            .tracker
            .as_mut()
            .map(|tracker| tracker.title(Instant::now(), window))
            .unwrap_or_default();
        self.emit(seen);
    }

    fn tick(&mut self) {
        self.drain_commands();
        let seen = self
            .tracker
            .as_mut()
            .map(|tracker| tracker.tick(Instant::now()))
            .unwrap_or_default();
        self.emit(seen);
    }

    fn emit(&self, seen: Vec<Observation>) {
        let Some(policy) = &self.policy else { return };
        for observation in seen {
            tracing::info!(
                kind = observation.kind.as_str(),
                exe = %observation.window.exe,
                duration_ms = ?observation.duration_ms,
                shot = observation.shot,
                "observation"
            );
            let shot = observation
                .shot
                .then_some((policy.max_width, policy.jpeg_quality));
            let job = Job {
                ts: unix_ms(),
                observation,
                shot,
            };
            if self.jobs.send(job).is_err() {
                tracing::error!("the evidence worker is gone");
            }
        }
    }
}

unsafe extern "system" fn on_event(
    _hook: HWINEVENTHOOK,
    event: u32,
    hwnd: HWND,
    id_object: i32,
    id_child: i32,
    _thread: u32,
    _time: u32,
) {
    if hwnd.is_null() || id_object != OBJID_WINDOW || id_child != CHILDID_SELF as i32 {
        return;
    }
    STATE.with(|cell| {
        let mut slot = cell.borrow_mut();
        let Some(state) = slot.as_mut() else { return };
        match event {
            EVENT_SYSTEM_FOREGROUND => state.on_foreground(hwnd),
            EVENT_OBJECT_NAMECHANGE => state.on_title(hwnd),
            _ => {}
        }
    });
}

/// What the evidence says about the window (limits mirror the shared schema).
fn evidence_data(observation: &Observation) -> EvidenceData {
    let window = &observation.window;
    EvidenceData {
        exe: Some(truncate(&window.exe, MAX_EXE_CHARS)),
        path: Some(truncate(&window.path, MAX_PATH_CHARS)),
        pid: Some(window.pid),
        title: Some(truncate(&window.title, MAX_TITLE_CHARS)),
        duration_ms: observation.duration_ms,
    }
}

fn shoot(width: u32, quality: u8) -> Option<Screenshot> {
    let started = Instant::now();
    let shot = match capture::grab(width) {
        Ok(shot) => shot,
        Err(error) => {
            tracing::error!(%error, "capture failed");
            return None;
        }
    };
    let black = capture::black_stats(&shot.bgra).is_black();
    let jpeg = match capture::encode_jpeg(&shot, quality) {
        Ok(jpeg) => jpeg,
        Err(error) => {
            tracing::error!(%error, "encode failed");
            return None;
        }
    };
    tracing::info!(
        width = shot.width,
        height = shot.height,
        screen = ?shot.source,
        bytes = jpeg.len(),
        black,
        ms = started.elapsed().as_millis(),
        "screenshot"
    );
    Some(Screenshot {
        jpeg_base64: STANDARD.encode(&jpeg),
        width: shot.width,
        height: shot.height,
    })
}

/// Takes the screenshots in order and passes the evidence on. A failed capture still reports the
/// observation, without a picture.
fn worker(jobs: &Receiver<Job>, out: &Sender<FromHelper>) {
    while let Ok(job) = jobs.recv() {
        let screenshot = job.shot.and_then(|(width, quality)| shoot(width, quality));
        let body = EvidenceBody {
            ts: job.ts,
            kind: job.observation.kind.as_str().to_string(),
            data: evidence_data(&job.observation),
            screenshot,
        };
        if out.send(FromHelper::Evidence { body }).is_err() {
            return;
        }
    }
}

/// Installs the hooks and runs the message loop on this thread until the process ends.
pub fn run(commands: Receiver<Command>, evidence: Sender<FromHelper>) -> Result<(), String> {
    let (jobs, queue) = mpsc::channel();
    thread::spawn(move || worker(&queue, &evidence));
    STATE.with(|cell| {
        *cell.borrow_mut() = Some(State {
            commands,
            jobs,
            policy: None,
            exam: None,
            tracker: None,
        });
    });

    let hook = |event: u32| {
        // Out-of-context: the callback runs on this thread inside the message loop below.
        // SAFETY: `on_event` has the WINEVENTPROC signature and lives for the whole process.
        unsafe {
            SetWinEventHook(
                event,
                event,
                null_mut(),
                Some(on_event),
                0,
                0,
                WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
            )
        }
    };
    let foreground = hook(EVENT_SYSTEM_FOREGROUND);
    if foreground.is_null() {
        return Err(crate::win::last_error("SetWinEventHook"));
    }
    let title = hook(EVENT_OBJECT_NAMECHANGE);
    if title.is_null() {
        // SAFETY: the handle came from SetWinEventHook.
        unsafe { UnhookWinEvent(foreground) };
        return Err(crate::win::last_error("SetWinEventHook"));
    }
    // SAFETY: a thread timer (no window); its WM_TIMER messages arrive in the loop below.
    let timer = unsafe { SetTimer(null_mut(), 0, TICK_MS, None) };
    if timer == 0 {
        tracing::warn!("{}", crate::win::last_error("SetTimer"));
    }
    tracing::info!("foreground and title hooks installed");

    let mut msg = MSG::default();
    loop {
        // SAFETY: valid MSG out pointer; null hwnd = every message of this thread.
        let got = unsafe { GetMessageW(&mut msg, null_mut(), 0, 0) };
        if got == 0 || got == -1 {
            break;
        }
        if msg.message == WM_TIMER && msg.hwnd.is_null() {
            STATE.with(|cell| {
                if let Some(state) = cell.borrow_mut().as_mut() {
                    state.tick();
                }
            });
            continue;
        }
        // SAFETY: `msg` was just filled by GetMessageW.
        unsafe {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
    // SAFETY: the handles came from SetWinEventHook and SetTimer.
    unsafe {
        KillTimer(null_mut(), timer);
        UnhookWinEvent(foreground);
        UnhookWinEvent(title);
    }
    tracing::info!("helper message loop ended");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::Kind;

    #[test]
    fn exe_name_is_the_last_path_part() {
        assert_eq!(exe_name(r"C:\Program Files\Google\chrome.exe"), "chrome.exe");
        assert_eq!(exe_name("notepad.exe"), "notepad.exe");
        assert_eq!(exe_name(""), "");
    }

    #[test]
    fn long_text_is_cut_to_the_schema_limit() {
        let long = "é".repeat(900);
        assert_eq!(truncate(&long, MAX_TITLE_CHARS).chars().count(), 500);
        assert_eq!(truncate("short", MAX_TITLE_CHARS), "short");
    }

    #[test]
    fn evidence_carries_the_window_and_the_duration() {
        let observation = Observation {
            kind: Kind::FocusReturned,
            window: Window {
                pid: 7,
                exe: "chrome.exe".into(),
                path: r"C:\chrome.exe".into(),
                title: "Google".into(),
            },
            duration_ms: Some(1500),
            shot: false,
        };
        let data = evidence_data(&observation);
        assert_eq!(data.exe.as_deref(), Some("chrome.exe"));
        assert_eq!(data.pid, Some(7));
        assert_eq!(data.title.as_deref(), Some("Google"));
        assert_eq!(data.duration_ms, Some(1500));
    }

    #[test]
    fn the_real_front_window_can_be_described() {
        // SAFETY: no arguments.
        let front = unsafe { GetForegroundWindow() };
        if front.is_null() {
            return; // no foreground window in this session
        }
        if let Some(window) = window_of(front) {
            assert!(window.pid > 0);
        }
    }
}
