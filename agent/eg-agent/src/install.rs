//! `eg-agent --install` / `--uninstall`: registers the service with the SCM. Needs an elevated
//! shell. Both are safe to repeat: the installer runs `--install` on every install and upgrade
//! (an existing service is removed first, from whatever path) and `--uninstall` on uninstall.

use std::ffi::OsString;
use std::thread::sleep;
use std::time::{Duration, Instant};

use windows_service::service::{
    ServiceAccess, ServiceAction, ServiceActionType, ServiceErrorControl, ServiceFailureActions,
    ServiceFailureResetPeriod, ServiceInfo, ServiceStartType, ServiceState, ServiceType,
};
use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};

use crate::service::SERVICE_NAME;

const ERROR_SERVICE_DOES_NOT_EXIST: i32 = 1060;
/// How long a stop may take before the service is deleted anyway.
const STOP_WITHIN: Duration = Duration::from_secs(15);
/// How long the SCM may keep a deleted service "marked for deletion".
const GONE_WITHIN: Duration = Duration::from_secs(20);
const POLL: Duration = Duration::from_millis(250);

pub fn install() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| format!("current_exe: {e}"))?;
    remove_existing()?;
    let manager =
        ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CREATE_SERVICE)
            .map_err(|e| format!("open the service manager (run as administrator): {e}"))?;
    let info = ServiceInfo {
        name: OsString::from(SERVICE_NAME),
        display_name: OsString::from("ExamGuard Agent"),
        service_type: ServiceType::OWN_PROCESS,
        start_type: ServiceStartType::AutoStart,
        error_control: ServiceErrorControl::Normal,
        executable_path: exe,
        launch_arguments: vec![OsString::from("--service")],
        dependencies: vec![],
        account_name: None, // LocalSystem
        account_password: None,
    };
    let access = ServiceAccess::CHANGE_CONFIG | ServiceAccess::START;
    let service = manager
        .create_service(&info, access)
        .map_err(|e| format!("create the service: {e}"))?;
    service
        .set_description(
            "ExamGuard monitoring agent: reports app switches, launches and screenshots to the \
             teacher during an exam. It never blocks or closes apps.",
        )
        .map_err(|e| format!("set the description: {e}"))?;
    // If the service process itself crashes, the SCM brings it back.
    let restart = ServiceAction {
        action_type: ServiceActionType::Restart,
        delay: Duration::from_secs(1),
    };
    service
        .update_failure_actions(ServiceFailureActions {
            reset_period: ServiceFailureResetPeriod::After(Duration::from_secs(60)),
            reboot_msg: None,
            command: None,
            actions: Some(vec![restart.clone(), restart.clone(), restart]),
        })
        .map_err(|e| format!("set the failure actions: {e}"))?;
    service
        .start::<OsString>(&[])
        .map_err(|e| format!("start the service: {e}"))?;
    Ok(())
}

/// Stops and removes the service. Nothing to do when it is not installed.
pub fn uninstall() -> Result<(), String> {
    remove_existing()
}

fn is_missing(error: &windows_service::Error) -> bool {
    matches!(error, windows_service::Error::Winapi(e)
        if e.raw_os_error() == Some(ERROR_SERVICE_DOES_NOT_EXIST))
}

/// Polls `done` until it says yes or the time runs out.
fn wait_for(within: Duration, mut done: impl FnMut() -> bool) -> bool {
    let deadline = Instant::now() + within;
    loop {
        if done() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        sleep(POLL);
    }
}

/// Stops and deletes the service if it exists, then waits until the SCM has really removed it
/// (a delete only marks it while the process still runs or someone holds a handle).
fn remove_existing() -> Result<(), String> {
    let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)
        .map_err(|e| format!("open the service manager (run as administrator): {e}"))?;
    let access = ServiceAccess::QUERY_STATUS | ServiceAccess::STOP | ServiceAccess::DELETE;
    let service = match manager.open_service(SERVICE_NAME, access) {
        Ok(service) => service,
        Err(error) if is_missing(&error) => return Ok(()),
        Err(error) => return Err(format!("open the service: {error}")),
    };
    let stopped = || {
        service
            .query_status()
            .map_or(true, |s| s.current_state == ServiceState::Stopped)
    };
    if !stopped() {
        // Already stopping is fine.
        let _ = service.stop();
        if !wait_for(STOP_WITHIN, stopped) {
            tracing::warn!("the service did not stop in time; deleting it anyway");
        }
    }
    // A second delete of a marked service fails; the wait below decides.
    let _ = service.delete();
    drop(service);
    let gone = wait_for(GONE_WITHIN, || {
        matches!(
            manager.open_service(SERVICE_NAME, ServiceAccess::QUERY_STATUS),
            Err(ref error) if is_missing(error)
        )
    });
    if gone {
        Ok(())
    } else {
        Err("the old service is still marked for deletion (close the Services window or \
             restart Windows, then try again)"
            .to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_missing_service_counts_as_missing() {
        let missing = windows_service::Error::Winapi(std::io::Error::from_raw_os_error(1060));
        let denied = windows_service::Error::Winapi(std::io::Error::from_raw_os_error(5));
        assert!(is_missing(&missing));
        assert!(!is_missing(&denied));
        assert!(!is_missing(&windows_service::Error::LaunchArgumentsNotSupported));
    }

    #[test]
    fn wait_for_stops_when_done_or_late() {
        let mut calls = 0;
        assert!(wait_for(Duration::from_secs(5), || {
            calls += 1;
            calls == 2
        }));
        assert_eq!(calls, 2);
        assert!(!wait_for(Duration::ZERO, || false));
    }
}
