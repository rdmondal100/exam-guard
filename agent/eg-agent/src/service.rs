//! `eg-agent --service`: the SCM entry point.
//!
//! Keeps one helper alive in the logged-on console session. When nobody is logged on there is no
//! helper; when the user logs off the helper ends with the session, and the next logon gets a new
//! one. The helper runs with the service's SYSTEM token (see `session.rs`).

use std::ffi::OsString;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

use windows_service::service::{
    ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus, ServiceType,
};
use windows_service::service_control_handler::{self, ServiceControlHandlerResult};
use windows_service::{define_windows_service, service_dispatcher};

use crate::session::{self, Child};
use crate::spike_dir;

pub const SERVICE_NAME: &str = "ExamGuardAgent";
const SERVICE_TYPE: ServiceType = ServiceType::OWN_PROCESS;

const POLL_INTERVAL: Duration = Duration::from_secs(1);
const FIRST_RETRY: Duration = Duration::from_secs(1);
const MAX_RETRY: Duration = Duration::from_secs(30);
/// A helper that ran this long counts as healthy, so the next failure starts the backoff over.
const HEALTHY_AFTER: Duration = Duration::from_secs(30);

define_windows_service!(ffi_service_main, service_main);

/// Called from `main()` for `--service`. Blocks until the service stops.
pub fn run() -> windows_service::Result<()> {
    spike_dir::init_log("service.log");
    service_dispatcher::start(SERVICE_NAME, ffi_service_main)
}

fn service_main(_arguments: Vec<OsString>) {
    if let Err(error) = run_service() {
        tracing::error!(%error, "service failed");
    }
}

fn status(state: ServiceState, accepted: ServiceControlAccept, code: u32) -> ServiceStatus {
    ServiceStatus {
        service_type: SERVICE_TYPE,
        current_state: state,
        controls_accepted: accepted,
        exit_code: ServiceExitCode::Win32(code),
        checkpoint: 0,
        wait_hint: Duration::default(),
        process_id: None,
    }
}

fn run_service() -> windows_service::Result<()> {
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let handle = service_control_handler::register(SERVICE_NAME, move |control| match control {
        ServiceControl::Stop | ServiceControl::Shutdown => {
            let _ = stop_tx.send(());
            ServiceControlHandlerResult::NoError
        }
        ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
        _ => ServiceControlHandlerResult::NotImplemented,
    })?;

    let accepted = ServiceControlAccept::STOP | ServiceControlAccept::SHUTDOWN;
    handle.set_service_status(status(ServiceState::Running, accepted, 0))?;
    tracing::info!(version = env!("CARGO_PKG_VERSION"), "service running");

    let outcome = supervise_helper(&stop_rx);
    if let Err(error) = &outcome {
        tracing::error!(%error, "supervision ended with an error");
    }
    tracing::info!("service stopped");
    let code = u32::from(outcome.is_err());
    handle.set_service_status(status(
        ServiceState::Stopped,
        ServiceControlAccept::empty(),
        code,
    ))
}

/// Delay before the next launch attempt: starts at `FIRST_RETRY`, doubles up to `MAX_RETRY`, and
/// starts over after a helper that stayed up for `HEALTHY_AFTER`.
fn next_retry(previous: Duration, ran_for: Duration) -> Duration {
    if ran_for >= HEALTHY_AFTER {
        FIRST_RETRY
    } else {
        (previous * 2).min(MAX_RETRY)
    }
}

fn supervise_helper(stop: &Receiver<()>) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| format!("current_exe: {e}"))?;
    let mut child: Option<(Child, Instant)> = None;
    let mut retry = FIRST_RETRY;
    let mut not_before = Instant::now();

    // Any message or a dropped sender means stop.
    while let Err(RecvTimeoutError::Timeout) = stop.recv_timeout(POLL_INTERVAL) {
        let active = session::active_user_session();

        if let Some((helper, started)) = &child {
            if let Some(code) = helper.exited() {
                tracing::warn!(pid = helper.pid, code, "helper exited");
                retry = next_retry(retry, started.elapsed());
                not_before = Instant::now() + retry;
                child = None;
            } else if active != Some(helper.session) {
                tracing::info!(
                    pid = helper.pid,
                    session = helper.session,
                    "session changed, stopping helper"
                );
                helper.kill();
                child = None;
                retry = FIRST_RETRY;
                not_before = Instant::now();
            }
        }

        if child.is_some() || Instant::now() < not_before {
            continue;
        }
        let Some(session) = active else { continue };
        match session::launch_in_session(session, &exe, "--helper") {
            Ok(helper) => {
                tracing::info!(pid = helper.pid, session, "helper started");
                child = Some((helper, Instant::now()));
            }
            Err(error) => {
                tracing::error!(session, %error, "could not start the helper");
                retry = next_retry(retry, Duration::ZERO);
                not_before = Instant::now() + retry;
            }
        }
    }

    if let Some((helper, _)) = child {
        helper.kill();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_backs_off_and_resets() {
        let mut d = FIRST_RETRY;
        d = next_retry(d, Duration::from_secs(1));
        assert_eq!(d, Duration::from_secs(2));
        for _ in 0..10 {
            d = next_retry(d, Duration::from_secs(1));
        }
        assert_eq!(d, MAX_RETRY);
        assert_eq!(next_retry(d, HEALTHY_AFTER), FIRST_RETRY);
    }
}
