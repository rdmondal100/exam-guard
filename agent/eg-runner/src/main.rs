//! eg-runner: runs one student program in a Job Object with time, memory and process limits.
//! Usage: `eg-runner --mem <MB> --time <ms> [--procs N] [--report <file>] [--shell] -- <argv…>`.
//! Design: docs/architecture.md §4.

mod args;
mod cmdline;
mod job;
mod report;

use std::process::ExitCode;

use windows_sys::core::BOOL;
use windows_sys::Win32::System::Console::{SetConsoleCtrlHandler, CTRL_BREAK_EVENT, CTRL_C_EVENT};
use windows_sys::Win32::System::Diagnostics::Debug::{
    SetErrorMode, SEM_FAILCRITICALERRORS, SEM_NOGPFAULTERRORBOX,
};

/// Swallows Ctrl+C / Ctrl+Break for eg-runner only. A handler routine is not inherited, unlike
/// `SetConsoleCtrlHandler(None, TRUE)`, so the shell still gets the key and can stop its command.
unsafe extern "system" fn ignore_break(ctrl: u32) -> BOOL {
    BOOL::from(ctrl == CTRL_C_EVENT || ctrl == CTRL_BREAK_EVENT)
}

fn main() -> ExitCode {
    // Logs go to stderr, which the student sees, so they are off unless RUST_LOG is set.
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("off")),
        )
        .init();

    let args = match args::parse(std::env::args().skip(1)) {
        Ok(args) => args,
        Err(error) => {
            eprintln!("eg-runner: {error}");
            return ExitCode::from(report::EXIT_USAGE as u8);
        }
    };
    // No "program stopped working" dialog for a crashing student program (the mode is inherited).
    // SAFETY: only changes this process's error mode.
    unsafe { SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX) };
    if args.shell {
        // SAFETY: registers a handler for this process; `ignore_break` lives for the whole run.
        if unsafe { SetConsoleCtrlHandler(Some(ignore_break), 1) } == 0 {
            tracing::warn!("could not install the Ctrl+C handler");
        }
    }

    let limits = job::Limits {
        mem_mb: args.mem_mb,
        time_ms: args.time_ms,
        procs: args.procs,
    };
    let result = job::run(&args.command, &limits);
    if let Some(path) = &args.report {
        if let Err(error) = std::fs::write(path, result.to_json()) {
            tracing::error!(%error, "could not write the report");
        }
    } else if let Some(error) = &result.error {
        eprintln!("eg-runner: {error}");
    }
    ExitCode::from(result.reason.exit_code() as u8)
}
