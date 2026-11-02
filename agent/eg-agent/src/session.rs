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
use windows_sys::Win32::System::Environment::{CreateEnvironmentBlock, DestroyEnvironmentBlock};
use windows_sys::Win32::System::RemoteDesktop::{
    ProcessIdToSessionId, WTSGetActiveConsoleSessionId, WTSQueryUserToken,
};
use windows_sys::Win32::System::Threading::{
    CreateProcessAsUserW, GetCurrentProcess, GetExitCodeProcess, OpenProcessToken,
    TerminateProcess, WaitForSingleObject, CREATE_NEW_PROCESS_GROUP, CREATE_NO_WINDOW,
    CREATE_UNICODE_ENVIRONMENT, PROCESS_INFORMATION, STARTUPINFOW,
};

use crate::relaunch::LaunchSpec;
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

/// Starts the student app with our own token (`--console`, where we are the student). Returns its pid.
pub fn launch_app_same_user(_session: u32, spec: &LaunchSpec) -> Result<u32, String> {
    let mut command = Command::new(&spec.exe);
    command
        .args(&spec.args)
        .env_remove("ELECTRON_RUN_AS_NODE")
        .envs(spec.env.iter().map(|(k, v)| (k, v)))
        .creation_flags(CREATE_NEW_PROCESS_GROUP);
    if let Some(cwd) = &spec.cwd {
        command.current_dir(cwd);
    }
    let child = command
        .spawn()
        .map_err(|e| format!("start {}: {e}", spec.exe.display()))?;
    Ok(child.id())
}

/// The student's environment (from their token) with `extra` set on top, as a Unicode block.
fn environment_for(token: HANDLE, extra: &[(String, String)]) -> Result<Vec<u16>, String> {
    let mut block: *mut core::ffi::c_void = null_mut();
    // SAFETY: valid out pointer and token; the block is freed below.
    check(
        unsafe { CreateEnvironmentBlock(&mut block, token, 0) },
        "CreateEnvironmentBlock",
    )?;
    let mut vars: Vec<(String, String)> = Vec::new();
    // SAFETY: the block is a run of NUL-terminated UTF-16 strings ending with an empty one.
    unsafe {
        let mut cursor = block as *const u16;
        loop {
            let mut len = 0usize;
            while *cursor.add(len) != 0 {
                len += 1;
            }
            if len == 0 {
                break;
            }
            let entry = String::from_utf16_lossy(std::slice::from_raw_parts(cursor, len));
            vars.push(split_variable(&entry));
            cursor = cursor.add(len + 1);
        }
        DestroyEnvironmentBlock(block);
    }
    Ok(merge_environment(vars, extra))
}

/// `NAME=value`. Names like `=C:` (the per-drive folders) start with `=`, so the split skips it.
fn split_variable(entry: &str) -> (String, String) {
    let skip = usize::from(entry.starts_with('='));
    match entry[skip..].find('=') {
        Some(at) => (
            entry[..skip + at].to_string(),
            entry[skip + at + 1..].to_string(),
        ),
        None => (entry.to_string(), String::new()),
    }
}

/// `vars` with `extra` replacing same-named entries (names compare case-insensitively), as a block.
fn merge_environment(mut vars: Vec<(String, String)>, extra: &[(String, String)]) -> Vec<u16> {
    vars.retain(|(name, _)| {
        !name.eq_ignore_ascii_case("ELECTRON_RUN_AS_NODE")
            && !extra.iter().any(|(n, _)| n.eq_ignore_ascii_case(name))
    });
    vars.extend(extra.iter().cloned());
    vars.sort_by_key(|(name, _)| name.to_uppercase());
    let mut block = Vec::new();
    for (name, value) in vars {
        block.extend(format!("{name}={value}").encode_utf16());
        block.push(0);
    }
    block.push(0);
    block
}

/// Starts the student app in `session` with the logged-on user's own token (`WTSQueryUserToken`,
/// which needs the service's SYSTEM rights) on `winsta0\default`. Returns its pid.
pub fn launch_app_as_user(session: u32, spec: &LaunchSpec) -> Result<u32, String> {
    let app = wide(&spec.exe.to_string_lossy());
    let mut line = wide(&spec.command_line());
    let mut desktop = wide(r"winsta0\default");
    let cwd = spec.cwd.as_ref().map(|c| wide(&c.to_string_lossy()));
    // SAFETY: plain Win32 calls; every buffer outlives the call that uses it.
    unsafe {
        let mut token: HANDLE = null_mut();
        check(WTSQueryUserToken(session, &mut token), "WTSQueryUserToken")?;
        let token = owned(token, "WTSQueryUserToken")?;
        let environment = environment_for(token.as_raw_handle(), &spec.env)?;
        let startup = STARTUPINFOW {
            cb: size_of::<STARTUPINFOW>() as u32,
            lpDesktop: desktop.as_mut_ptr(),
            ..Default::default()
        };
        let mut info = PROCESS_INFORMATION::default();
        check(
            CreateProcessAsUserW(
                token.as_raw_handle(),
                app.as_ptr(),
                line.as_mut_ptr(),
                null(),
                null(),
                0,
                CREATE_UNICODE_ENVIRONMENT,
                environment.as_ptr().cast(),
                cwd.as_ref().map_or(null(), |c| c.as_ptr()),
                &startup,
                &mut info,
            ),
            "CreateProcessAsUser",
        )?;
        drop(owned(info.hThread, "CreateProcessAsUser"));
        drop(owned(info.hProcess, "CreateProcessAsUser"));
        Ok(info.dwProcessId)
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn decode(block: &[u16]) -> Vec<String> {
        String::from_utf16_lossy(block)
            .split('\0')
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .collect()
    }

    #[test]
    fn variables_split_at_the_first_equals_sign_after_a_leading_one() {
        assert_eq!(split_variable("A=b=c"), ("A".into(), "b=c".into()));
        assert_eq!(split_variable(r"=C:=C:\x"), ("=C:".into(), r"C:\x".into()));
        assert_eq!(split_variable("LONE"), ("LONE".into(), String::new()));
    }

    #[test]
    fn extra_variables_replace_the_users_and_run_as_node_never_passes() {
        let vars = vec![
            ("Path".to_string(), r"C:\Windows".to_string()),
            ("EG_PROFILE".to_string(), "old".to_string()),
            ("ELECTRON_RUN_AS_NODE".to_string(), "1".to_string()),
            ("=C:".to_string(), r"C:\".to_string()),
        ];
        let block = merge_environment(vars, &[("eg_profile".to_string(), "new".to_string())]);
        assert_eq!(block[block.len() - 2..], [0, 0]);
        assert_eq!(
            decode(&block),
            vec![r"=C:=C:\", "eg_profile=new", r"Path=C:\Windows"]
        );
    }

    #[test]
    fn the_console_launch_starts_the_program_with_its_arguments() {
        let spec = LaunchSpec {
            exe: PathBuf::from(r"C:\Windows\System32\cmd.exe"),
            args: vec!["/c".into(), "exit".into(), "0".into()],
            cwd: Some(std::env::temp_dir()),
            env: vec![("EG_TEST".into(), "1".into())],
        };
        assert!(launch_app_same_user(0, &spec).unwrap() > 0);
    }
}
