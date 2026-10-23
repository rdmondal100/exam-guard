//! `eg-agent --service`: the SCM entry point.
//!
//! The SCM side only: registers with the service dispatcher, reports Running, and turns Stop and
//! Shutdown into a message for `supervisor::run`, which keeps one helper alive in the logged-on
//! console session (with the service's SYSTEM token, see `session.rs`).

use std::ffi::OsString;
use std::sync::mpsc;
use std::time::Duration;

use windows_service::service::{
    ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus, ServiceType,
};
use windows_service::service_control_handler::{self, ServiceControlHandlerResult};
use windows_service::{define_windows_service, service_dispatcher};

use crate::supervisor::{self, Platform};

pub const SERVICE_NAME: &str = "ExamGuardAgent";
const SERVICE_TYPE: ServiceType = ServiceType::OWN_PROCESS;

define_windows_service!(ffi_service_main, service_main);

/// Called from `main()` for `--service`. Blocks until the service stops.
pub fn run() -> windows_service::Result<()> {
    crate::log::init_file("service.log");
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

    let platform = Platform::service();
    let outcome = crate::link::run_with_link(&platform, || supervisor::run(&stop_rx, &platform));
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
