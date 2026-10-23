//! Finds the logged-on console session and starts a process there with the service's own
//! SYSTEM token (architecture §3: DuplicateTokenEx → TokenSessionId → CreateProcessAsUserW).

use std::os::windows::io::{AsRawHandle, OwnedHandle};
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::Command;
use std::ptr::{null, null_mut};

use windows_sys::Win32::Foundation::{HANDLE, WAIT_OBJECT_0};
use windows_sys::Win32::Security::{
    DuplicateTokenEx, SecurityIdentification, SetTokenInformation, TokenPrimary, TokenSessionId,
    TOKEN_ALL_ACCESS,
};
use windows_sys::Win32::System::RemoteDesktop::{
    ProcessIdToSessionId, WTSGetActiveConsoleSessionId, WTSQueryUserToken,
};
use windows_sys::Win32::System::Threading::{
    CreateProcessAsUserW, GetCurrentProcess, GetExitCodeProcess, OpenProcessToken,
    TerminateProcess, WaitForSingleObject, CREATE_NEW_PROCESS_GROUP, CREATE_NO_WINDOW,
    PROCESS_INFORMATION, STARTUPINFOW,
};

use crate::win::{check, owned, wide};

const NO_SESSION: u32 = 0xFFFF_FFFF;

/// The active console session, if a user is logged on to it (not the logon screen).
pub fn active_user_session() -> Option<u32> {
    // SAFETY: no arguments.
    let session = unsafe { WTSGetActiveConsoleSessionId() };
    if session == NO_SESSION {
        return None;
    }
    let mut token: HANDLE = null_mut();
    // SAFETY: valid out pointer. Needs SeTcbPrivilege (LocalSystem has it).
    if unsafe { WTSQueryUserToken(session, &mut token) } == 0 {
        return None;
    }
    // Only asked to learn whether someone is logged on; close it at once.
    drop(owned(token, "WTSQueryUserToken"));
    Some(session)
}

/// The session this process runs in.
pub fn current_session() -> Option<u32> {
    let mut session = 0u32;
    // SAFETY: valid out pointer.
    (unsafe { ProcessIdToSessionId(std::process::id(), &mut session) } != 0).then_some(session)
}

/// Starts `exe args` with our own token in our own session (`--console`). It gets its own process
/// group, so a Ctrl+C meant for the supervisor does not also end it.
pub fn launch_same_user(session: u32, exe: &Path, args: &str) -> Result<Child, String> {
    let child = Command::new(exe)
        .arg(args)
        .creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP)
        .spawn()
        .map_err(|e| format!("start {}: {e}", exe.display()))?;
    let pid = child.id();
    Ok(Child {
        process: OwnedHandle::from(child),
        pid,
        session,
    })
}

/// A process the supervisor started in a user session.
pub struct Child {
    pub process: OwnedHandle,
    pub pid: u32,
    pub session: u32,
}

impl Child {
    /// `Some(exit code)` once the process has ended.
    pub fn exited(&self) -> Option<u32> {
        // SAFETY: valid process handle; timeout 0 never blocks.
        if unsafe { WaitForSingleObject(self.process.as_raw_handle(), 0) } != WAIT_OBJECT_0 {
            return None;
        }
        let mut code = 0u32;
        // SAFETY: valid process handle and out pointer.
        unsafe { GetExitCodeProcess(self.process.as_raw_handle(), &mut code) };
        Some(code)
    }

    pub fn kill(&self) {
        // SAFETY: valid process handle.
        unsafe {
            TerminateProcess(self.process.as_raw_handle(), 0);
            WaitForSingleObject(self.process.as_raw_handle(), 2_000);
        }
    }
}

/// Starts `exe args` in `session` on `winsta0\default` with a copy of our own (SYSTEM) token.
pub fn launch_in_session(session: u32, exe: &Path, args: &str) -> Result<Child, String> {
    let exe_text = exe.to_string_lossy();
    let app = wide(&exe_text);
    let mut line = wide(&format!("\"{exe_text}\" {args}"));
    let mut desktop = wide(r"winsta0\default");
    // SAFETY: plain Win32 calls; every buffer outlives the call that uses it.
    unsafe {
        let mut own: HANDLE = null_mut();
        check(
            OpenProcessToken(GetCurrentProcess(), TOKEN_ALL_ACCESS, &mut own),
            "OpenProcessToken",
        )?;
        let own = owned(own, "OpenProcessToken")?;
        let mut dup: HANDLE = null_mut();
        check(
            DuplicateTokenEx(
                own.as_raw_handle(),
                TOKEN_ALL_ACCESS,
                null(),
                SecurityIdentification,
                TokenPrimary,
                &mut dup,
            ),
            "DuplicateTokenEx",
        )?;
        let dup = owned(dup, "DuplicateTokenEx")?;
        check(
            SetTokenInformation(
                dup.as_raw_handle(),
                TokenSessionId,
                (&session as *const u32).cast(),
                size_of::<u32>() as u32,
            ),
            "SetTokenInformation(TokenSessionId)",
        )?;
        let startup = STARTUPINFOW {
            cb: size_of::<STARTUPINFOW>() as u32,
            lpDesktop: desktop.as_mut_ptr(),
            ..Default::default()
        };
        let mut info = PROCESS_INFORMATION::default();
        check(
            CreateProcessAsUserW(
                dup.as_raw_handle(),
                app.as_ptr(),
                line.as_mut_ptr(),
                null(),
                null(),
                0,
                CREATE_NO_WINDOW,
                null(),
                null(),
                &startup,
                &mut info,
            ),
            "CreateProcessAsUser",
        )?;
        drop(owned(info.hThread, "CreateProcessAsUser"));
        Ok(Child {
            process: owned(info.hProcess, "CreateProcessAsUser")?,
            pid: info.dwProcessId,
            session,
        })
    }
}
