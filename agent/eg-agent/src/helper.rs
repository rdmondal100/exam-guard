//! `eg-agent --helper`: runs in the user's session (with a SYSTEM token when the service starts it),
//! logs every foreground switch and takes a screenshot at start and on a switch (at most 1 per 5 s).

use std::cell::RefCell;
use std::path::Path;
use std::ptr::null_mut;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use windows_sys::Win32::Foundation::HWND;
use windows_sys::Win32::System::RemoteDesktop::ProcessIdToSessionId;
use windows_sys::Win32::System::WindowsProgramming::GetUserNameW;
use windows_sys::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK};
use windows_sys::Win32::UI::HiDpi::{
    SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, GetForegroundWindow, GetMessageW, TranslateMessage, CHILDID_SELF,
    EVENT_SYSTEM_FOREGROUND, MSG, OBJID_WINDOW, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS,
};

use crate::{capture, spike_dir, window_info};

/// Minimum gap between two screenshots.
pub const SHOT_GAP: Duration = Duration::from_secs(5);

/// Lets an action through at most once per `gap`.
pub struct Throttle {
    gap: Duration,
    last: Option<Instant>,
}

impl Throttle {
    pub fn new(gap: Duration) -> Self {
        Self { gap, last: None }
    }

    pub fn ready(&mut self, now: Instant) -> bool {
        if self
            .last
            .is_some_and(|last| now.duration_since(last) < self.gap)
        {
            return false;
        }
        self.last = Some(now);
        true
    }
}

thread_local! {
    static SHOTS: RefCell<Throttle> = RefCell::new(Throttle::new(SHOT_GAP));
}

fn user_name() -> String {
    let mut buf = [0u16; 256];
    let mut len = buf.len() as u32;
    // SAFETY: the buffer is valid for `len` characters.
    if unsafe { GetUserNameW(buf.as_mut_ptr(), &mut len) } == 0 {
        return "?".to_string();
    }
    // `len` includes the terminating NUL.
    String::from_utf16_lossy(&buf[..(len as usize).saturating_sub(1)])
}

fn session_id() -> Option<u32> {
    let mut session = 0u32;
    // SAFETY: valid out pointer.
    (unsafe { ProcessIdToSessionId(std::process::id(), &mut session) } != 0).then_some(session)
}

fn unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis())
}

/// Captures, encodes and saves one screenshot, and logs what it looked like.
fn take_shot(reason: &str) {
    let started = Instant::now();
    let shot = match capture::grab(capture::MAX_WIDTH) {
        Ok(shot) => shot,
        Err(error) => {
            tracing::error!(reason, %error, "capture failed");
            return;
        }
    };
    let grab_ms = started.elapsed().as_millis();
    let stats = capture::black_stats(&shot.bgra);
    let jpeg = match capture::encode_jpeg(&shot, capture::JPEG_QUALITY) {
        Ok(jpeg) => jpeg,
        Err(error) => {
            tracing::error!(reason, %error, "encode failed");
            return;
        }
    };
    let folder = spike_dir::dir();
    let path = folder.join(spike_dir::shot_name(unix_ms()));
    if let Err(error) = std::fs::write(&path, &jpeg) {
        tracing::error!(reason, %error, "could not save the screenshot");
        return;
    }
    tracing::info!(
        reason,
        file = %file_name(&path),
        width = shot.width,
        height = shot.height,
        source = ?shot.source,
        bytes = jpeg.len(),
        grab_ms,
        total_ms = started.elapsed().as_millis(),
        mean_luma = stats.mean_luma,
        lit_share = stats.lit_share,
        black = stats.is_black(),
        "screenshot"
    );
    if let Err(error) = spike_dir::prune(&folder, spike_dir::KEEP_SHOTS) {
        tracing::warn!(%error, "could not prune old screenshots");
    }
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map_or_else(String::new, |n| n.to_string_lossy().into_owned())
}

fn log_window(what: &str, hwnd: HWND) {
    let info = window_info::describe(hwnd);
    match &info.exe {
        Ok(exe) => tracing::info!(pid = info.pid, exe = %exe, title = %info.title, "{what}"),
        Err(error) => {
            tracing::info!(pid = info.pid, exe_error = %error, title = %info.title, "{what}")
        }
    }
}

unsafe extern "system" fn on_foreground(
    _hook: HWINEVENTHOOK,
    event: u32,
    hwnd: HWND,
    id_object: i32,
    id_child: i32,
    _thread: u32,
    _time: u32,
) {
    if event != EVENT_SYSTEM_FOREGROUND
        || hwnd.is_null()
        || id_object != OBJID_WINDOW
        || id_child != CHILDID_SELF as i32
    {
        return;
    }
    log_window("foreground", hwnd);
    if SHOTS.with(|t| t.borrow_mut().ready(Instant::now())) {
        take_shot("switch");
    }
}

pub fn run() -> Result<(), String> {
    spike_dir::init_log("helper.log");
    // SAFETY: called once at start, before any window or DC exists.
    let dpi_ok =
        unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) != 0 };
    tracing::info!(
        pid = std::process::id(),
        user = %user_name(),
        session = ?session_id(),
        dpi_ok,
        "helper started"
    );

    // SAFETY: no arguments.
    let current = unsafe { GetForegroundWindow() };
    if !current.is_null() {
        log_window("foreground at start", current);
    }
    SHOTS.with(|t| t.borrow_mut().ready(Instant::now()));
    take_shot("start");

    // Out-of-context: the callback runs on this thread inside the message loop below.
    // SAFETY: `on_foreground` has the WINEVENTPROC signature and lives for the whole process.
    let hook = unsafe {
        SetWinEventHook(
            EVENT_SYSTEM_FOREGROUND,
            EVENT_SYSTEM_FOREGROUND,
            null_mut(),
            Some(on_foreground),
            0,
            0,
            WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
        )
    };
    if hook.is_null() {
        return Err(crate::win::last_error("SetWinEventHook"));
    }
    tracing::info!("foreground hook installed");

    let mut msg = MSG::default();
    loop {
        // SAFETY: valid MSG out pointer; null hwnd = every message of this thread.
        let got = unsafe { GetMessageW(&mut msg, null_mut(), 0, 0) };
        if got == 0 || got == -1 {
            break;
        }
        // SAFETY: `msg` was just filled by GetMessageW.
        unsafe {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
    // SAFETY: the hook handle came from SetWinEventHook.
    unsafe { UnhookWinEvent(hook) };
    tracing::info!("helper message loop ended");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn throttle_lets_one_through_per_gap() {
        let mut throttle = Throttle::new(Duration::from_secs(5));
        let t0 = Instant::now();
        assert!(throttle.ready(t0));
        assert!(!throttle.ready(t0 + Duration::from_millis(4_999)));
        assert!(throttle.ready(t0 + Duration::from_secs(5)));
        assert!(!throttle.ready(t0 + Duration::from_secs(6)));
        assert!(throttle.ready(t0 + Duration::from_secs(10)));
    }

    #[test]
    fn user_name_is_known() {
        assert_ne!(user_name(), "?");
    }
}
