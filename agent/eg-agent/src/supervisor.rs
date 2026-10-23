//! Keeps one helper alive in the active user session. Shared by the service and `--console`; they
//! differ only in how a session is found and a process is started (`Platform`).
//!
//! A helper that ends after running for a while (killed, logoff) is relaunched at once. One that
//! keeps dying young is relaunched with a growing delay, so a broken install does not spin.

use std::path::Path;
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

use crate::config::{FIRST_RETRY, MAX_RETRY, POLL_INTERVAL, STABLE_AFTER};
use crate::pipe_security::{SDDL_HELPER_PIPE_CONSOLE, SDDL_HELPER_PIPE_SERVICE};
use crate::session::{self, Child};

pub struct Platform {
    /// Who may connect to the helper pipe: the service runs the helper as SYSTEM, `--console` as you.
    pub helper_pipe_sddl: &'static str,
    /// `--console` only: the student app may also be named by `EG_ALLOWED_APP`.
    pub allow_env_app: bool,
    pub active_session: fn() -> Option<u32>,
    pub launch: fn(session: u32, exe: &Path, args: &str) -> Result<Child, String>,
}

impl Platform {
    /// The service: the logged-on console session, and a helper with the service's SYSTEM token.
    pub fn service() -> Self {
        Self {
            helper_pipe_sddl: SDDL_HELPER_PIPE_SERVICE,
            allow_env_app: false,
            active_session: session::active_user_session,
            launch: session::launch_in_session,
        }
    }

    /// `--console`: our own session, and a helper with our own token.
    pub fn console() -> Self {
        Self {
            helper_pipe_sddl: SDDL_HELPER_PIPE_CONSOLE,
            allow_env_app: true,
            active_session: session::current_session,
            launch: session::launch_same_user,
        }
    }
}

/// Delay before the next launch. One early exit is forgiven (someone killed the helper); the
/// second in a row starts the delays at `FIRST_RETRY` and doubles them.
#[derive(Default)]
pub struct Backoff {
    delay: Duration,
    early_exits: u32,
}

impl Backoff {
    /// The helper ended after running for `ran_for`.
    pub fn after_exit(&mut self, ran_for: Duration) -> Duration {
        if ran_for >= STABLE_AFTER {
            self.reset();
            return Duration::ZERO;
        }
        self.early_exits += 1;
        if self.early_exits == 1 {
            Duration::ZERO
        } else {
            self.escalate()
        }
    }

    /// A launch that failed is never retried at once.
    pub fn after_failed_launch(&mut self) -> Duration {
        self.escalate()
    }

    pub fn reset(&mut self) {
        *self = Self::default();
    }

    fn escalate(&mut self) -> Duration {
        self.delay = if self.delay.is_zero() {
            FIRST_RETRY
        } else {
            (self.delay * 2).min(MAX_RETRY)
        };
        self.delay
    }
}

struct Running {
    helper: Child,
    started: Instant,
}

/// Runs until `stop` gets a message (or its sender is dropped), then ends the helper.
pub fn run(stop: &Receiver<()>, platform: &Platform) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| format!("current_exe: {e}"))?;
    let mut running: Option<Running> = None;
    let mut backoff = Backoff::default();
    let mut not_before = Instant::now();
    let mut exited_at: Option<Instant> = None;

    while let Err(RecvTimeoutError::Timeout) = stop.recv_timeout(POLL_INTERVAL) {
        let active = (platform.active_session)();

        if let Some(current) = &running {
            if let Some(code) = current.helper.exited() {
                let delay = backoff.after_exit(current.started.elapsed());
                tracing::warn!(
                    pid = current.helper.pid,
                    code,
                    restart_in_ms = delay.as_millis(),
                    "helper exited"
                );
                not_before = Instant::now() + delay;
                exited_at = Some(Instant::now());
                running = None;
            } else if active != Some(current.helper.session) {
                tracing::info!(
                    pid = current.helper.pid,
                    session = current.helper.session,
                    "session changed, stopping helper"
                );
                current.helper.kill();
                backoff.reset();
                not_before = Instant::now();
                exited_at = None;
                running = None;
            }
        }

        if running.is_some() || Instant::now() < not_before {
            continue;
        }
        let Some(session) = active else { continue };
        match (platform.launch)(session, &exe, "--helper") {
            Ok(helper) => {
                tracing::info!(
                    pid = helper.pid,
                    session,
                    since_exit_ms = exited_at.map(|t| t.elapsed().as_millis()),
                    "helper started"
                );
                exited_at = None;
                running = Some(Running {
                    helper,
                    started: Instant::now(),
                });
            }
            Err(error) => {
                let delay = backoff.after_failed_launch();
                tracing::error!(
                    session,
                    %error,
                    retry_in_ms = delay.as_millis(),
                    "could not start the helper"
                );
                not_before = Instant::now() + delay;
            }
        }
    }

    if let Some(current) = running {
        current.helper.kill();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_helper_that_ran_a_while_comes_back_at_once_every_time() {
        let mut backoff = Backoff::default();
        for _ in 0..5 {
            assert_eq!(backoff.after_exit(STABLE_AFTER), Duration::ZERO);
        }
    }

    #[test]
    fn the_first_early_exit_is_forgiven_then_a_crash_loop_backs_off_up_to_the_limit() {
        let mut backoff = Backoff::default();
        let young = Duration::from_secs(1);
        assert_eq!(backoff.after_exit(young), Duration::ZERO);
        assert_eq!(backoff.after_exit(young), FIRST_RETRY);
        assert_eq!(backoff.after_exit(young), Duration::from_secs(2));
        for _ in 0..10 {
            backoff.after_exit(young);
        }
        assert_eq!(backoff.after_failed_launch(), MAX_RETRY);
    }

    #[test]
    fn a_failed_launch_is_never_retried_at_once() {
        let mut backoff = Backoff::default();
        assert_eq!(backoff.after_failed_launch(), FIRST_RETRY);
    }

    #[test]
    fn a_stable_run_or_a_reset_starts_the_backoff_over() {
        let mut backoff = Backoff::default();
        let young = Duration::from_secs(1);
        backoff.after_exit(young);
        backoff.after_exit(young);
        assert_eq!(backoff.after_exit(STABLE_AFTER), Duration::ZERO);
        assert_eq!(backoff.after_exit(young), Duration::ZERO);
        backoff.reset();
        assert_eq!(backoff.after_exit(young), Duration::ZERO);
    }
}
