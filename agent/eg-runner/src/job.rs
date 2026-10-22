//! Runs one program inside a Windows Job Object with memory, process and wall-time limits.

use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::ptr::{null, null_mut};
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::{
    SetHandleInformation, HANDLE, HANDLE_FLAG_INHERIT, INVALID_HANDLE_VALUE, WAIT_OBJECT_0,
    WAIT_TIMEOUT,
};
use windows_sys::Win32::System::Console::{
    GetStdHandle, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE,
};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectAssociateCompletionPortInformation,
    JobObjectExtendedLimitInformation, QueryInformationJobObject, SetInformationJobObject,
    TerminateJobObject, JOBOBJECT_ASSOCIATE_COMPLETION_PORT, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_ACTIVE_PROCESS, JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOB_OBJECT_LIMIT_PROCESS_MEMORY,
};
use windows_sys::Win32::System::SystemServices::{
    JOB_OBJECT_MSG_ACTIVE_PROCESS_LIMIT, JOB_OBJECT_MSG_PROCESS_MEMORY_LIMIT,
};
use windows_sys::Win32::System::Threading::{
    CreateProcessW, GetExitCodeProcess, ResumeThread, TerminateProcess, WaitForSingleObject,
    CREATE_SUSPENDED, PROCESS_INFORMATION, STARTF_USESTDHANDLES, STARTUPINFOW,
};
use windows_sys::Win32::System::IO::{
    CreateIoCompletionPort, GetQueuedCompletionStatus, OVERLAPPED,
};

use crate::cmdline;
use crate::report::{Reason, Report};

pub struct Limits {
    pub mem_mb: u64,
    /// Wall time; 0 = none.
    pub time_ms: u64,
    pub procs: u32,
}

/// How often the wait loop wakes to read job messages.
const SLICE_MS: u32 = 20;

fn last_error(what: &str) -> String {
    format!("{what} failed: {}", std::io::Error::last_os_error())
}

fn owned(handle: HANDLE, what: &str) -> Result<OwnedHandle, String> {
    if handle.is_null() || handle == INVALID_HANDLE_VALUE {
        return Err(last_error(what));
    }
    // SAFETY: the handle was just returned by the OS and is owned by nobody else.
    Ok(unsafe { OwnedHandle::from_raw_handle(handle) })
}

fn check(ok: i32, what: &str) -> Result<(), String> {
    if ok == 0 {
        Err(last_error(what))
    } else {
        Ok(())
    }
}

/// Limit hits the job reported so far.
#[derive(Default)]
struct Hits {
    memory: bool,
    processes: bool,
}

fn drain(port: &OwnedHandle, hits: &mut Hits) {
    loop {
        let mut message = 0u32;
        let mut key = 0usize;
        let mut overlapped: *mut OVERLAPPED = null_mut();
        // SAFETY: valid port handle and out pointers; timeout 0 never blocks.
        let ok = unsafe {
            GetQueuedCompletionStatus(
                port.as_raw_handle(),
                &mut message,
                &mut key,
                &mut overlapped,
                0,
            )
        };
        if ok == 0 {
            return;
        }
        match message {
            JOB_OBJECT_MSG_PROCESS_MEMORY_LIMIT => hits.memory = true,
            JOB_OBJECT_MSG_ACTIVE_PROCESS_LIMIT => hits.processes = true,
            _ => {}
        }
    }
}

fn create_job(limits: &Limits) -> Result<(OwnedHandle, OwnedHandle), String> {
    // SAFETY: plain Win32 calls; every pointer is valid for the duration of the call.
    unsafe {
        let job = owned(CreateJobObjectW(null(), null()), "CreateJobObject")?;
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_PROCESS_MEMORY
            | JOB_OBJECT_LIMIT_ACTIVE_PROCESS
            | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;
        info.BasicLimitInformation.ActiveProcessLimit = limits.procs;
        info.ProcessMemoryLimit = usize::try_from(limits.mem_mb.saturating_mul(1024 * 1024))
            .map_err(|_| "--mem is too large".to_string())?;
        check(
            SetInformationJobObject(
                job.as_raw_handle(),
                JobObjectExtendedLimitInformation,
                (&info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            ),
            "SetInformationJobObject(limits)",
        )?;
        let port = owned(
            CreateIoCompletionPort(INVALID_HANDLE_VALUE, null_mut(), 0, 1),
            "CreateIoCompletionPort",
        )?;
        let assoc = JOBOBJECT_ASSOCIATE_COMPLETION_PORT {
            CompletionKey: null_mut(),
            CompletionPort: port.as_raw_handle(),
        };
        check(
            SetInformationJobObject(
                job.as_raw_handle(),
                JobObjectAssociateCompletionPortInformation,
                (&assoc as *const JOBOBJECT_ASSOCIATE_COMPLETION_PORT).cast(),
                size_of::<JOBOBJECT_ASSOCIATE_COMPLETION_PORT>() as u32,
            ),
            "SetInformationJobObject(port)",
        )?;
        Ok((job, port))
    }
}

/// Starts the child suspended, puts it in the job, then lets it run.
fn spawn_in_job(command: &[String], job: &OwnedHandle) -> Result<OwnedHandle, String> {
    let mut line: Vec<u16> = cmdline::join(command)
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    // SAFETY: plain Win32 calls; `line` is a writable NUL-terminated buffer as CreateProcessW wants.
    unsafe {
        let startup = STARTUPINFOW {
            cb: size_of::<STARTUPINFOW>() as u32,
            dwFlags: STARTF_USESTDHANDLES,
            hStdInput: GetStdHandle(STD_INPUT_HANDLE),
            hStdOutput: GetStdHandle(STD_OUTPUT_HANDLE),
            hStdError: GetStdHandle(STD_ERROR_HANDLE),
            ..Default::default()
        };
        // The child gets our stdio (Node's pipes). Make sure they are inheritable; a failure
        // here only matters for handles that are not real (no stdio), so it is ignored.
        for h in [startup.hStdInput, startup.hStdOutput, startup.hStdError] {
            if !h.is_null() && h != INVALID_HANDLE_VALUE {
                SetHandleInformation(h, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);
            }
        }
        let mut info = PROCESS_INFORMATION::default();
        check(
            CreateProcessW(
                null(),
                line.as_mut_ptr(),
                null(),
                null(),
                1,
                CREATE_SUSPENDED,
                null(),
                null(),
                &startup,
                &mut info,
            ),
            &format!("starting '{}'", command.first().map_or("", String::as_str)),
        )?;
        let process = owned(info.hProcess, "CreateProcess")?;
        let thread = owned(info.hThread, "CreateProcess")?;
        if AssignProcessToJobObject(job.as_raw_handle(), process.as_raw_handle()) == 0 {
            let error = last_error("AssignProcessToJobObject");
            TerminateProcess(process.as_raw_handle(), 1);
            return Err(error);
        }
        if ResumeThread(thread.as_raw_handle()) == u32::MAX {
            return Err(last_error("ResumeThread"));
        }
        Ok(process)
    }
}

fn peak_mem_mb(job: &OwnedHandle) -> u64 {
    let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    // SAFETY: `info` is the right size for this information class.
    let ok = unsafe {
        QueryInformationJobObject(
            job.as_raw_handle(),
            JobObjectExtendedLimitInformation,
            (&mut info as *mut JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            null_mut(),
        )
    };
    if ok == 0 {
        return 0;
    }
    (info.PeakProcessMemoryUsed as u64).div_ceil(1024 * 1024)
}

/// Runs `command` under `limits` and reports why it ended.
pub fn run(command: &[String], limits: &Limits) -> Report {
    match run_inner(command, limits) {
        Ok(report) => report,
        Err(error) => Report::failed(error),
    }
}

fn run_inner(command: &[String], limits: &Limits) -> Result<Report, String> {
    let (job, port) = create_job(limits)?;
    let process = spawn_in_job(command, &job)?;
    let started = Instant::now();
    let deadline = (limits.time_ms > 0).then(|| started + Duration::from_millis(limits.time_ms));
    let mut hits = Hits::default();
    let mut timed_out = false;
    loop {
        drain(&port, &mut hits);
        // SAFETY: valid process handle.
        let wait = unsafe { WaitForSingleObject(process.as_raw_handle(), SLICE_MS) };
        if wait == WAIT_OBJECT_0 {
            break;
        }
        if wait != WAIT_TIMEOUT {
            return Err(last_error("WaitForSingleObject"));
        }
        if deadline.is_some_and(|d| Instant::now() >= d) {
            timed_out = true;
            // SAFETY: valid job handle; kills every process in it.
            unsafe {
                TerminateJobObject(job.as_raw_handle(), 1);
                WaitForSingleObject(process.as_raw_handle(), 2000);
            }
            break;
        }
    }
    let elapsed = started.elapsed();
    drain(&port, &mut hits);
    let mut code = 0u32;
    // SAFETY: valid process handle and out pointer.
    let exit_code = (unsafe { GetExitCodeProcess(process.as_raw_handle(), &mut code) } != 0)
        // Exit codes are read back as the signed value C programs return.
        .then_some(i64::from(code as i32));
    // A refused process start explains a fork loop better than the time limit it then runs into.
    let reason = if hits.processes {
        Reason::ProcessLimit
    } else if timed_out {
        Reason::TimeLimit
    } else if hits.memory {
        Reason::MemoryLimit
    } else {
        Reason::Ok
    };
    tracing::debug!(reason = reason.as_str(), ?exit_code, "run ended");
    Ok(Report {
        reason,
        exit_code,
        time_ms: u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX),
        peak_mem_mb: peak_mem_mb(&job),
        error: None,
    })
    // Dropping `job` closes it; KILL_ON_JOB_CLOSE ends anything the program left running.
}
