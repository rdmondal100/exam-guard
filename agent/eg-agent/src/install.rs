//! `eg-agent --install` / `--uninstall`: registers the service with the SCM. Needs an elevated shell.

use std::ffi::OsString;
use std::time::Duration;

use windows_service::service::{
    ServiceAccess, ServiceAction, ServiceActionType, ServiceErrorControl, ServiceFailureActions,
    ServiceFailureResetPeriod, ServiceInfo, ServiceStartType, ServiceState, ServiceType,
};
use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};

use crate::service::SERVICE_NAME;

pub fn install() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| format!("current_exe: {e}"))?;
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
        .set_description("ExamGuard monitoring agent (spike)")
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

pub fn uninstall() -> Result<(), String> {
    let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)
        .map_err(|e| format!("open the service manager (run as administrator): {e}"))?;
    let access = ServiceAccess::QUERY_STATUS | ServiceAccess::STOP | ServiceAccess::DELETE;
    let service = manager
        .open_service(SERVICE_NAME, access)
        .map_err(|e| format!("open the service: {e}"))?;
    if service
        .query_status()
        .map_err(|e| e.to_string())?
        .current_state
        != ServiceState::Stopped
    {
        // Already stopping is fine.
        let _ = service.stop();
    }
    service
        .delete()
        .map_err(|e| format!("delete the service: {e}"))?;
    Ok(())
}
