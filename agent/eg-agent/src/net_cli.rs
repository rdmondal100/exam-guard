//! The M21a test switch of `eg-agent --console`:
//!
//!   eg-agent --console --net-block <ip[,ip...]> [--net-lease-secs N]
//!
//! Blocks outbound internet except to the given addresses (the teacher PC), logs
//! `internet_blocked`, and takes these lines on stdin: `renew` (restart the lease), `off`, `on`
//! (block again). Ctrl+C removes the filters; so does the lease running out, or killing the process.
//! M21b replaces the stdin with the app's `net.set` messages and heartbeat acks.

use std::io::BufRead;
use std::net::Ipv4Addr;
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use crate::config::{NET_LEASE, NET_LEASE_MAX, NET_TICK};
use crate::net_block::{NetBlock, Tick};
use crate::net_rules::parse_addresses;
use crate::wfp_engine::WfpBackend;

#[derive(Debug, PartialEq, Eq)]
pub struct Options {
    pub allow: Vec<Ipv4Addr>,
    pub lease: Duration,
}

/// `args` are the words after `--console`. `None` means the switch is not used.
pub fn parse(args: &[String]) -> Result<Option<Options>, String> {
    let mut allow = None;
    let mut lease = NET_LEASE;
    let mut words = args.iter();
    while let Some(word) = words.next() {
        let mut value = |flag: &str| words.next().ok_or_else(|| format!("{flag} needs a value"));
        match word.as_str() {
            "--net-block" => allow = Some(parse_addresses(value("--net-block")?)?),
            "--net-lease-secs" => lease = parse_lease(value("--net-lease-secs")?)?,
            other => return Err(format!("unknown argument `{other}`")),
        }
    }
    match allow {
        Some(allow) => Ok(Some(Options { allow, lease })),
        None if lease != NET_LEASE => Err("--net-lease-secs needs --net-block".to_string()),
        None => Ok(None),
    }
}

fn parse_lease(text: &str) -> Result<Duration, String> {
    let secs: u64 = text
        .parse()
        .map_err(|_| format!("`{text}` is not a number of seconds"))?;
    let lease = Duration::from_secs(secs);
    if secs == 0 || lease > NET_LEASE_MAX {
        return Err(format!(
            "the lease must be 1 to {} seconds",
            NET_LEASE_MAX.as_secs()
        ));
    }
    Ok(lease)
}

enum Command {
    Renew,
    Off,
    On,
    Stop,
}

fn command_of(line: &str) -> Option<Command> {
    match line.trim().to_ascii_lowercase().as_str() {
        "renew" => Some(Command::Renew),
        "off" => Some(Command::Off),
        "on" => Some(Command::On),
        _ => None,
    }
}

pub struct NetSwitch {
    tx: Sender<Command>,
    worker: JoinHandle<()>,
}

impl NetSwitch {
    /// Removes the filters and waits for the worker.
    pub fn stop(self) {
        // The worker is already gone if its first block failed.
        let _ = self.tx.send(Command::Stop);
        let _ = self.worker.join();
    }
}

pub fn start(options: Options) -> NetSwitch {
    let (tx, rx) = mpsc::channel();
    let stdin_tx = tx.clone();
    // Detached on purpose: it sits in a blocking read until the process ends.
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines().map_while(Result::ok) {
            match command_of(&line) {
                Some(command) => {
                    if stdin_tx.send(command).is_err() {
                        break;
                    }
                }
                None if !line.trim().is_empty() => {
                    tracing::warn!(%line, "unknown command; use renew, off or on");
                }
                None => {}
            }
        }
    });
    let worker = std::thread::spawn(move || work(&options, &rx));
    NetSwitch { tx, worker }
}

fn block(net: &mut NetBlock<WfpBackend>, options: &Options) {
    match net.apply(&options.allow, options.lease, Instant::now()) {
        Ok(()) => tracing::info!(
            allow = ?options.allow,
            lease_secs = options.lease.as_secs(),
            "internet_blocked"
        ),
        Err(error) => tracing::error!(%error, "internet_block_failed"),
    }
}

fn work(options: &Options, rx: &Receiver<Command>) {
    let mut net = NetBlock::new(WfpBackend::default());
    block(&mut net, options);
    if !net.is_active() {
        return;
    }
    loop {
        match rx.recv_timeout(NET_TICK) {
            Ok(Command::Renew) => {
                if net.renew(Instant::now()) {
                    tracing::info!(lease_secs = options.lease.as_secs(), "lease renewed");
                } else {
                    tracing::warn!("nothing is blocked; type `on` first");
                }
            }
            Ok(Command::Off) => match net.release() {
                Ok(()) => tracing::info!("internet_allowed (off)"),
                Err(error) => tracing::error!(%error, "internet filters not removed, retrying"),
            },
            Ok(Command::On) => block(&mut net, options),
            Ok(Command::Stop) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        if let Tick::Released(result) = net.tick(Instant::now()) {
            match result {
                Ok(()) => tracing::info!("internet_allowed (lease)"),
                Err(error) => tracing::error!(%error, "internet filters not removed, retrying"),
            }
        }
    }
    drop(net);
    tracing::info!("internet_allowed (stopped)");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn no_arguments_means_the_switch_is_off() {
        assert_eq!(parse(&[]), Ok(None));
    }

    #[test]
    fn an_address_list_uses_the_default_lease() {
        let options = parse(&args(&["--net-block", "192.168.1.10,10.0.0.2"]))
            .expect("parse")
            .expect("some");
        assert_eq!(options.allow.len(), 2);
        assert_eq!(options.lease, NET_LEASE);
    }

    #[test]
    fn the_lease_can_be_set_in_either_order() {
        let options = parse(&args(&[
            "--net-lease-secs",
            "120",
            "--net-block",
            "10.0.0.2",
        ]))
        .expect("parse")
        .expect("some");
        assert_eq!(options.lease, Duration::from_secs(120));
    }

    #[test]
    fn a_missing_or_bad_address_is_an_error() {
        assert!(parse(&args(&["--net-block"])).is_err());
        assert!(parse(&args(&["--net-block", "example.com"])).is_err());
        assert!(parse(&args(&["--net-block", "0.0.0.0"])).is_err());
    }

    #[test]
    fn the_lease_is_limited_to_the_cap() {
        let block = |secs: &str| {
            parse(&args(&[
                "--net-block",
                "10.0.0.2",
                "--net-lease-secs",
                secs,
            ]))
        };
        assert!(block("600").is_ok());
        assert!(block("601").is_err());
        assert!(block("0").is_err());
        assert!(block("-5").is_err());
        assert!(block("soon").is_err());
    }

    #[test]
    fn a_lease_without_a_block_and_unknown_flags_are_errors() {
        assert!(parse(&args(&["--net-lease-secs", "30"])).is_err());
        assert!(parse(&args(&["--net-unblock"])).is_err());
    }

    #[test]
    fn stdin_words_map_to_commands() {
        assert!(matches!(command_of(" Renew \r\n"), Some(Command::Renew)));
        assert!(matches!(command_of("off"), Some(Command::Off)));
        assert!(matches!(command_of("ON"), Some(Command::On)));
        assert!(command_of("stop").is_none());
    }
}
