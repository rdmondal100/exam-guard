//! Where the agent keeps its files, and the timings of the helper supervision.

use std::path::PathBuf;
use std::time::Duration;

/// How often the supervisor looks at the helper. This bounds how long a dead helper goes unnoticed.
pub const POLL_INTERVAL: Duration = Duration::from_millis(200);
/// Delay before the launch after the second early exit in a row; it doubles up to `MAX_RETRY`.
pub const FIRST_RETRY: Duration = Duration::from_secs(1);
pub const MAX_RETRY: Duration = Duration::from_secs(30);
/// A helper that ran this long was healthy: its end (a kill, a logoff) is not a crash loop, so the
/// next launch is immediate and the delays start over.
pub const STABLE_AFTER: Duration = Duration::from_secs(5);
/// A log file over this size is moved to `<name>.old` when the process starts.
pub const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;

/// The pipe the student app talks to, and the one the helper reports on (architecture §3).
pub const APP_PIPE: &str = r"\\.\pipe\examguard-agent";
pub const HELPER_PIPE: &str = r"\\.\pipe\examguard-helper";
/// App pipe instances. All are created at start so no other process can create one.
pub const APP_PIPE_INSTANCES: u32 = 3;
/// Heartbeat to the app; no ack for three of them and the service drops the connection.
pub const HEARTBEAT: Duration = Duration::from_secs(2);
pub const HEARTBEAT_LOST: Duration = Duration::from_secs(6);
/// A connected app must say hello within this time.
pub const HELLO_WITHIN: Duration = Duration::from_secs(5);

/// `%ProgramData%\ExamGuard\spike`: logs and screenshots. It is still the M19 folder because the
/// student app's "What the agent saw" view reads it; M22 moves the evidence into the pipe.
pub fn data_dir() -> PathBuf {
    let base = std::env::var_os("ProgramData")
        .map_or_else(|| PathBuf::from(r"C:\ProgramData"), PathBuf::from);
    base.join("ExamGuard").join("spike")
}
