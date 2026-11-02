//! Which desktop gets the keyboard: the student's (`Default`) or a secure one (Ctrl+Alt+Del, the
//! lock screen, a UAC prompt: `Winlogon`; the screen saver: `Screen-saver`).

use windows_sys::Win32::Foundation::{GetLastError, ERROR_ACCESS_DENIED, HANDLE};
use windows_sys::Win32::System::StationsAndDesktops::{
    CloseDesktop, GetUserObjectInformationW, OpenInputDesktop, DESKTOP_READOBJECTS, UOI_NAME,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InputDesktop {
    Default,
    /// Another desktop has the input; `None` when we may not even open it (a `--console` run as the
    /// user cannot open `Winlogon`, which is exactly when it is up).
    Other(Option<String>),
}

/// The desktop that receives input now. An unexpected failure counts as `Default`, so a broken
/// call never reports a security screen that was not there.
pub fn input_desktop() -> InputDesktop {
    // SAFETY: plain call; the handle is closed below.
    let desk = unsafe { OpenInputDesktop(0, 0, DESKTOP_READOBJECTS) };
    if desk.is_null() {
        // SAFETY: no arguments.
        let error = unsafe { GetLastError() };
        if error == ERROR_ACCESS_DENIED {
            return InputDesktop::Other(None);
        }
        tracing::debug!(error, "OpenInputDesktop failed");
        return InputDesktop::Default;
    }
    let name = desktop_name(desk);
    // SAFETY: the handle came from OpenInputDesktop.
    unsafe { CloseDesktop(desk) };
    match name {
        Some(name) if !name.eq_ignore_ascii_case("Default") => InputDesktop::Other(Some(name)),
        _ => InputDesktop::Default,
    }
}

fn desktop_name(desk: HANDLE) -> Option<String> {
    let mut buf = [0u16; 128];
    let mut needed = 0u32;
    // SAFETY: the buffer and its size in bytes match; `needed` is a valid out pointer.
    let ok = unsafe {
        GetUserObjectInformationW(
            desk,
            UOI_NAME,
            buf.as_mut_ptr().cast(),
            std::mem::size_of_val(&buf) as u32,
            &mut needed,
        )
    };
    if ok == 0 {
        return None;
    }
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    Some(String::from_utf16_lossy(&buf[..len]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_input_desktop_can_be_asked_for() {
        // Interactive runs see `Default`; a service-like test runner may not, so only check it
        // answers and that a name, when there is one, is not `Default`.
        if let InputDesktop::Other(Some(name)) = input_desktop() {
            assert!(!name.eq_ignore_ascii_case("Default"));
        }
    }
}
