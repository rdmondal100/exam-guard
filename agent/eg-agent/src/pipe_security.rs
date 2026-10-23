//! Who may talk to the agent: the pipe's access lists, and the check of a connecting process's
//! program file against the one the installer registered (docs/architecture.md §3).

use std::path::{Path, PathBuf};
use std::ptr::null_mut;

use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};
use windows_sys::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
};

use crate::win::{owned, wide};

/// Registry key and value that name the student app's program file. Only an administrator can
/// write under `HKLM\SOFTWARE`; the installer (M45) sets it, the dev install scripts set it to the
/// Electron binary.
const KEY: &str = r"SOFTWARE\ExamGuard";
const VALUE: &str = "AppPath";
/// `--console` only: names the app without touching the registry.
const ENV_ALLOWED_APP: &str = "EG_ALLOWED_APP";

/// `0x12019f` is `FILE_GENERIC_READ | FILE_GENERIC_WRITE`. Node opens a pipe asking for exactly that
/// (libuv), including `FILE_APPEND_DATA`, which on a pipe is also the right to create an instance;
/// a narrower grant makes it fall back to a one-way pipe.
/// App pipe: SYSTEM has full control and the interactive user reads and writes. That would let a
/// user create more instances of the pipe, but the server creates all of them up front with
/// `max_instances` equal to their number, so there is no slot left (pipe_server.rs).
pub const SDDL_APP_PIPE: &str = "D:(A;;FA;;;SY)(A;;0x12019f;;;IU)";
/// Helper pipe in the service: SYSTEM only. The helper runs as SYSTEM.
pub const SDDL_HELPER_PIPE_SERVICE: &str = "D:(A;;FA;;;SY)";
/// Helper pipe under `--console`: the helper runs as the developer, the interactive user.
pub const SDDL_HELPER_PIPE_CONSOLE: &str = "D:(A;;FA;;;SY)(A;;0x12019f;;;IU)";

/// The program file of a running process, if it can be read.
pub fn image_path(pid: u32) -> Option<PathBuf> {
    // SAFETY: plain call; the result is checked.
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    let process = owned(handle, "OpenProcess").ok()?;
    let mut buf = vec![0u16; 1024];
    let mut len = buf.len() as u32;
    // SAFETY: the buffer is valid for `len` characters.
    let ok = unsafe {
        QueryFullProcessImageNameW(
            std::os::windows::io::AsRawHandle::as_raw_handle(&process),
            0,
            buf.as_mut_ptr(),
            &mut len,
        )
    };
    (ok != 0).then(|| PathBuf::from(String::from_utf16_lossy(&buf[..len as usize])))
}

/// Same program file: case does not matter on Windows, and `\\?\` and `/` are only spellings.
pub fn same_image(a: &Path, b: &Path) -> bool {
    fn normal(path: &Path) -> String {
        let text = path.to_string_lossy().replace('/', r"\");
        text.strip_prefix(r"\\?\").unwrap_or(&text).to_lowercase()
    }
    normal(a) == normal(b)
}

/// The program file that may use the app pipe: the registry value, or (console mode only) the
/// environment variable. `None` means nobody may.
pub fn allowed_app(allow_env: bool) -> Option<PathBuf> {
    let path = registry_app_path().or_else(|| {
        allow_env
            .then(|| std::env::var_os(ENV_ALLOWED_APP).map(PathBuf::from))
            .flatten()
    })?;
    // A running process reports its real path, so resolve links (pnpm's node_modules) before comparing.
    Some(std::fs::canonicalize(&path).unwrap_or(path))
}

fn registry_app_path() -> Option<PathBuf> {
    let key = wide(KEY);
    let value = wide(VALUE);
    let mut bytes = 0u32;
    // SAFETY: the first call only asks for the size.
    let status = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            key.as_ptr(),
            value.as_ptr(),
            RRF_RT_REG_SZ,
            null_mut(),
            null_mut(),
            &mut bytes,
        )
    };
    if status != 0 || bytes < 2 {
        return None;
    }
    let mut buf = vec![0u16; (bytes as usize).div_ceil(2)];
    // SAFETY: the buffer holds `bytes` bytes.
    let status = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            key.as_ptr(),
            value.as_ptr(),
            RRF_RT_REG_SZ,
            null_mut(),
            buf.as_mut_ptr().cast(),
            &mut bytes,
        )
    };
    if status != 0 {
        return None;
    }
    let text = String::from_utf16_lossy(&buf);
    let text = text.trim_end_matches('\0').trim();
    (!text.is_empty()).then(|| PathBuf::from(text))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spelling_does_not_make_a_different_program() {
        let a = Path::new(r"C:\Program Files\ExamGuard\ExamGuard.exe");
        assert!(same_image(
            a,
            Path::new(r"c:\program files\examguard\EXAMGUARD.EXE")
        ));
        assert!(same_image(
            a,
            Path::new(r"\\?\C:\Program Files\ExamGuard\ExamGuard.exe")
        ));
        assert!(same_image(
            a,
            Path::new("C:/Program Files/ExamGuard/ExamGuard.exe")
        ));
        assert!(!same_image(a, Path::new(r"C:\Users\x\ExamGuard.exe")));
    }

    #[test]
    fn our_own_image_path_can_be_read() {
        let me = std::env::current_exe().unwrap();
        let found = image_path(std::process::id()).unwrap();
        assert!(same_image(&me, &found));
    }

    #[test]
    fn a_process_that_does_not_exist_has_no_image() {
        assert!(image_path(0xFFFF_FFF0).is_none());
    }
}
