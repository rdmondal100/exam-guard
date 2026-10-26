//! `eg-agent --helper`: runs in the user's session (with a SYSTEM token when the service starts it).
//! It links to the service (`helper_client`) and watches the foreground window (`focus`) while the
//! service says the exam is being monitored.

use std::sync::mpsc;

use windows_sys::Win32::System::WindowsProgramming::GetUserNameW;
use windows_sys::Win32::UI::HiDpi::{
    SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
};

use crate::{focus, helper_client, log, session};

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

pub fn run() -> Result<(), String> {
    log::init_file("helper.log");
    // SAFETY: called once at start, before any window or DC exists.
    let dpi_ok =
        unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) != 0 };
    tracing::info!(
        pid = std::process::id(),
        user = %user_name(),
        session = ?session::current_session(),
        dpi_ok,
        "helper started"
    );

    let (commands_tx, commands_rx) = mpsc::channel();
    let (evidence_tx, evidence_rx) = mpsc::channel();
    helper_client::spawn(commands_tx, evidence_rx);
    focus::run(commands_rx, evidence_tx)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_name_is_known() {
        assert_ne!(user_name(), "?");
    }
}
