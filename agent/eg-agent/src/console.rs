//! `eg-agent --console`: the service's job without the SCM, for development. Runs the same
//! supervisor in this console, with a helper under your own account. Ctrl+C stops both.
//! `--net-block` adds the M21a internet-off test switch (`net_cli`).

use std::sync::mpsc::{self, Sender};
use std::sync::OnceLock;

use windows_sys::Win32::System::Console::{
    SetConsoleCtrlHandler, CTRL_BREAK_EVENT, CTRL_CLOSE_EVENT, CTRL_C_EVENT,
};

use crate::supervisor::{self, Platform};

static STOP: OnceLock<Sender<()>> = OnceLock::new();

unsafe extern "system" fn on_ctrl(kind: u32) -> i32 {
    if !matches!(kind, CTRL_C_EVENT | CTRL_BREAK_EVENT | CTRL_CLOSE_EVENT) {
        return 0;
    }
    if let Some(stop) = STOP.get() {
        // The receiver is gone only when the supervisor already ended.
        let _ = stop.send(());
    }
    1
}

pub fn run() -> Result<(), String> {
    let rest: Vec<String> = std::env::args().skip(2).collect();
    let net = crate::net_cli::parse(&rest)?;
    crate::log::init_stderr();
    let (tx, rx) = mpsc::channel::<()>();
    STOP.set(tx).map_err(|_| "console started twice")?;
    // SAFETY: `on_ctrl` has the HANDLER_ROUTINE signature and lives for the whole process.
    crate::win::check(
        unsafe { SetConsoleCtrlHandler(Some(on_ctrl), 1) },
        "SetConsoleCtrlHandler",
    )?;
    tracing::info!(
        version = env!("CARGO_PKG_VERSION"),
        "console supervisor running"
    );
    let platform = Platform::console();
    let net = net.map(crate::net_cli::start);
    let outcome = crate::link::run_with_link(&platform, || supervisor::run(&rx, &platform));
    if let Some(net) = net {
        net.stop();
    }
    tracing::info!("console supervisor stopped");
    outcome
}
