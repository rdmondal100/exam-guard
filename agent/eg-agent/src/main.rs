//! eg-agent: Windows service + session helper that observes and reports.
//! M19 spike: install/uninstall, the service that launches the helper, and the helper itself.
//! Design: docs/architecture.md §3.

#[cfg(windows)]
mod capture;
#[cfg(windows)]
mod helper;
#[cfg(windows)]
mod install;
#[cfg(windows)]
mod service;
#[cfg(windows)]
mod session;
#[cfg(windows)]
mod spike_dir;
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
        // `--console` runs the helper in the current session without the service (dev).
        "--helper" | "--console" => helper::run(),
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
