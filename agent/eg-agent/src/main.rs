//! eg-agent: Windows service + session helper that observes and reports.
//! `--service` supervises one `--helper` in the user's session; `--console` does the same without
//! the SCM, for development. Design: docs/architecture.md §3.

#[cfg(windows)]
mod capture;
#[cfg(windows)]
mod config;
#[cfg(windows)]
mod console;
#[cfg(windows)]
mod evidence_queue;
#[cfg(windows)]
mod focus;
#[cfg(windows)]
mod helper;
#[cfg(windows)]
mod helper_client;
#[cfg(windows)]
mod helper_link;
#[cfg(windows)]
mod install;
#[cfg(windows)]
mod link;
#[cfg(windows)]
mod log;
#[cfg(windows)]
mod net_block;
#[cfg(windows)]
mod net_control;
#[cfg(windows)]
mod net_rules;
#[cfg(windows)]
mod pipe_conn;
#[cfg(windows)]
mod pipe_frame;
#[cfg(windows)]
mod pipe_msg;
#[cfg(windows)]
mod pipe_security;
#[cfg(windows)]
mod pipe_server;
#[cfg(windows)]
mod policy;
#[cfg(windows)]
mod process_tree;
#[cfg(windows)]
mod service;
#[cfg(windows)]
mod session;
#[cfg(windows)]
mod supervisor;
#[cfg(windows)]
mod system_check;
#[cfg(windows)]
mod wfp_engine;
#[cfg(windows)]
mod wfp_filter;
#[cfg(windows)]
mod win;
#[cfg(windows)]
mod window_info;

const USAGE: &str = "usage: eg-agent --install | --uninstall | --service | --helper | --console";

#[cfg(windows)]
fn main() -> std::process::ExitCode {
    use std::process::ExitCode;

    let mode = std::env::args().nth(1).unwrap_or_default();
    let result = match mode.as_str() {
        "--install" => install::install(),
        "--uninstall" => install::uninstall(),
        "--service" => service::run().map_err(|e| e.to_string()),
        "--helper" => helper::run(),
        "--console" => console::run(),
        _ => {
            eprintln!("{USAGE}");
            return ExitCode::from(2);
        }
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("eg-agent {mode}: {error}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(not(windows))]
fn main() {
    eprintln!("eg-agent only runs on Windows. {USAGE}");
}

#[cfg(test)]
mod tests {
    #[test]
    fn version_is_set() {
        assert!(!env!("CARGO_PKG_VERSION").is_empty());
    }
}
