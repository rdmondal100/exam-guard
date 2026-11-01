//! The running processes, and whether one belongs to the person at the keyboard (as opposed to
//! Windows itself): the raw Win32 side of `procwatch`.

use std::os::windows::io::AsRawHandle;
use std::ptr::null_mut;

use windows_sys::Win32::Foundation::{LocalFree, HANDLE};
use windows_sys::Win32::Security::Authorization::ConvertSidToStringSidW;
use windows_sys::Win32::Security::{GetTokenInformation, TokenUser, TOKEN_QUERY, TOKEN_USER};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::RemoteDesktop::ProcessIdToSessionId;
use windows_sys::Win32::System::Threading::{
    OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION,
};

use crate::win::owned;

/// One line of the process list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub pid: u32,
    pub parent: u32,
    /// File name only, as ToolHelp reports it (`notepad.exe`).
    pub exe: String,
}

/// Every process right now. Empty when the snapshot fails.
pub fn list() -> Vec<Entry> {
    let mut entries = Vec::new();
    // SAFETY: plain call; the handle is owned and closed on drop.
    let snapshot = match owned(
        unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) },
        "CreateToolhelp32Snapshot",
    ) {
        Ok(snapshot) => snapshot,
        Err(error) => {
            tracing::warn!(%error, "could not list the processes");
            return entries;
        }
    };
    let handle = snapshot.as_raw_handle();
    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..PROCESSENTRY32W::default()
    };
    // SAFETY: `entry` has its size set; the handle stays valid while `snapshot` lives.
    let mut more = unsafe { Process32FirstW(handle, &mut entry) } != 0;
    while more {
        let len = entry
            .szExeFile
            .iter()
            .position(|&c| c == 0)
            .unwrap_or(entry.szExeFile.len());
        entries.push(Entry {
            pid: entry.th32ProcessID,
            parent: entry.th32ParentProcessID,
            exe: String::from_utf16_lossy(&entry.szExeFile[..len]),
        });
        // SAFETY: as above.
        more = unsafe { Process32NextW(handle, &mut entry) } != 0;
    }
    entries
}

/// Windows' own accounts: SYSTEM, LOCAL SERVICE, NETWORK SERVICE and the per-session virtual
/// accounts (Desktop Window Manager, font driver host), `S-1-5-90-*`. Everything else in the
/// user's session is the user's, an administrator account included.
pub fn is_system_account(sid: &str) -> bool {
    matches!(sid, "S-1-5-18" | "S-1-5-19" | "S-1-5-20") || sid.starts_with("S-1-5-90-")
}

/// The process runs in `session` and not under a Windows account. A process whose owner cannot be
/// read (an elevated process asked from a standard `--console` run) counts as the user's: better
/// one report too many than a missed launch.
pub fn is_user_process(pid: u32, session: u32) -> bool {
    let mut process_session = 0u32;
    // SAFETY: valid out pointer.
    if unsafe { ProcessIdToSessionId(pid, &mut process_session) } == 0 || process_session != session
    {
        return false;
    }
    owner_sid(pid).is_none_or(|sid| !is_system_account(&sid))
}

fn owner_sid(pid: u32) -> Option<String> {
    // SAFETY: plain Win32 calls; handles are owned and closed on drop, the SID text is freed below.
    unsafe {
        let process = owned(
            OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid),
            "OpenProcess",
        )
        .ok()?;
        let mut token: HANDLE = null_mut();
        if OpenProcessToken(process.as_raw_handle(), TOKEN_QUERY, &mut token) == 0 {
            return None;
        }
        let token = owned(token, "OpenProcessToken").ok()?;
        // u64 elements keep the buffer aligned for TOKEN_USER.
        let mut buf = [0u64; 64];
        let mut needed = 0u32;
        if GetTokenInformation(
            token.as_raw_handle(),
            TokenUser,
            buf.as_mut_ptr().cast(),
            std::mem::size_of_val(&buf) as u32,
            &mut needed,
        ) == 0
        {
            return None;
        }
        let user = &*buf.as_ptr().cast::<TOKEN_USER>();
        let mut text: *mut u16 = null_mut();
        if ConvertSidToStringSidW(user.User.Sid, &mut text) == 0 {
            return None;
        }
        let len = (0..).take_while(|&i| *text.add(i) != 0).count();
        let sid = String::from_utf16_lossy(std::slice::from_raw_parts(text, len));
        LocalFree(text.cast());
        Some(sid)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session;

    #[test]
    fn windows_accounts_are_told_from_users() {
        assert!(is_system_account("S-1-5-18"));
        assert!(is_system_account("S-1-5-19"));
        assert!(is_system_account("S-1-5-90-0-1"));
        assert!(!is_system_account("S-1-5-21-1-2-3-1001"));
        assert!(!is_system_account("S-1-5-32-544"));
    }

    #[test]
    fn the_list_has_this_test_process() {
        let me = std::process::id();
        assert!(list()
            .iter()
            .any(|entry| entry.pid == me && !entry.exe.is_empty()));
    }

    #[test]
    fn this_test_process_is_a_user_process_in_its_own_session() {
        let session = session::current_session().expect("a session");
        let me = std::process::id();
        assert!(is_user_process(me, session));
        assert!(!is_user_process(me, session + 1));
        assert!(owner_sid(me).is_some_and(|sid| sid.starts_with("S-1-5-")));
    }
}
