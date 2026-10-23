//! What a window is: owning process id, its exe path and the window title.

use std::os::windows::io::AsRawHandle;

use windows_sys::Win32::Foundation::HWND;
use windows_sys::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{GetWindowTextW, GetWindowThreadProcessId};

use crate::win::owned;

#[derive(Debug)]
pub struct WindowInfo {
    pub pid: u32,
    /// Full image path, or the error that stopped us reading it.
    pub exe: Result<String, String>,
    pub title: String,
}

pub fn describe(hwnd: HWND) -> WindowInfo {
    let mut pid = 0u32;
    // SAFETY: any hwnd value is fine; a dead window just gives pid 0.
    unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
    WindowInfo {
        pid,
        exe: exe_path(pid),
        title: title(hwnd),
    }
}

fn title(hwnd: HWND) -> String {
    let mut buf = [0u16; 512];
    // SAFETY: the buffer is valid for its length.
    let len = unsafe { GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
    String::from_utf16_lossy(&buf[..usize::try_from(len).unwrap_or(0)])
}

pub fn exe_path(pid: u32) -> Result<String, String> {
    if pid == 0 {
        return Err("no process".to_string());
    }
    // SAFETY: plain Win32 calls; the handle is owned and closed on drop.
    unsafe {
        let process = owned(
            OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid),
            "OpenProcess",
        )?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        if QueryFullProcessImageNameW(
            process.as_raw_handle(),
            PROCESS_NAME_WIN32,
            buf.as_mut_ptr(),
            &mut len,
        ) == 0
        {
            return Err(crate::win::last_error("QueryFullProcessImageName"));
        }
        Ok(String::from_utf16_lossy(&buf[..len as usize]))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetShellWindow;

    #[test]
    fn reads_our_own_exe() {
        let path = exe_path(std::process::id()).unwrap();
        assert!(path.to_lowercase().ends_with(".exe"), "{path}");
    }

    #[test]
    fn describes_the_shell_window() {
        // SAFETY: no arguments.
        let shell = unsafe { GetShellWindow() };
        if shell.is_null() {
            return; // no Explorer in this session
        }
        let info = describe(shell);
        assert!(info.pid > 0);
        assert!(info.exe.unwrap().to_lowercase().ends_with("explorer.exe"));
    }

    #[test]
    fn pid_zero_has_no_exe() {
        assert!(exe_path(0).is_err());
    }
}
