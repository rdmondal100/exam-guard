//! The helper's side of the helper pipe: connects to the service, answers each `check` with a test
//! capture and the number of monitors, passes the service's monitoring commands to `focus`, and
//! sends `focus`'s evidence to the service. The service reconnects nothing; this loop does.
//!
//! One thread does all of it and never blocks in a read: a pipe handle opened without overlapped
//! I/O serialises its calls, so a blocked read would hold up the writes of the evidence.

use std::sync::mpsc::{Receiver, Sender};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use windows_sys::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CMONITORS};

use crate::focus::Command;
use crate::pipe_conn::Conn;
use crate::pipe_frame::{encode, FrameBuffer};
use crate::pipe_msg::{FromHelper, ToHelper};
use crate::{capture, config};

const RETRY: Duration = Duration::from_millis(500);
const POLL: Duration = Duration::from_millis(10);
/// The test capture is only checked for black, so a small one is enough and quick.
const PROBE_WIDTH: u32 = 640;

pub fn spawn(commands: Sender<Command>, evidence: Receiver<FromHelper>) -> JoinHandle<()> {
    thread::spawn(move || loop {
        // Evidence made while the service is away is dropped: the service replays what matters
        // (its monitoring state) when we reconnect, and a stale picture is of no use.
        while evidence.try_recv().is_ok() {}
        match Conn::connect(config::HELPER_PIPE) {
            Ok(conn) => {
                tracing::info!("connected to the service");
                let reason = serve(&conn, &commands, &evidence);
                tracing::warn!(reason, "service link ended");
            }
            Err(error) => tracing::debug!(%error, "service not reachable yet"),
        }
        thread::sleep(RETRY);
    })
}

fn send(conn: &Conn, message: &FromHelper) -> bool {
    let Ok(json) = serde_json::to_vec(message) else {
        return true;
    };
    let Ok(wire) = encode(&json) else {
        tracing::warn!(bytes = json.len(), "evidence too large for the pipe, dropped");
        return true;
    };
    conn.write_all(&wire).is_ok()
}

fn command_of(message: ToHelper) -> Option<Command> {
    match message {
        ToHelper::Check { .. } => None,
        ToHelper::MonitorStart { policy } => Some(Command::Start(policy)),
        ToHelper::MonitorStop => Some(Command::Stop),
        ToHelper::ExamWindow { hwnd, pid } => Some(Command::ExamWindow { hwnd, pid }),
    }
}

fn serve(
    conn: &Conn,
    commands: &Sender<Command>,
    evidence: &Receiver<FromHelper>,
) -> &'static str {
    let mut frames = FrameBuffer::default();
    let mut chunk = [0u8; 4096];
    loop {
        while let Ok(message) = evidence.try_recv() {
            if !send(conn, &message) {
                return "write failed";
            }
        }
        let waiting = match conn.available() {
            Ok(n) => n,
            Err(_) => return "pipe closed",
        };
        if waiting == 0 {
            thread::sleep(POLL);
            continue;
        }
        match conn.read(&mut chunk) {
            Ok(n) if n > 0 => frames.push(&chunk[..n]),
            _ => return "pipe closed",
        }
        loop {
            let frame = match frames.next_frame() {
                Ok(Some(frame)) => frame,
                Ok(None) => break,
                Err(_) => return "oversized frame",
            };
            let Ok(message) = serde_json::from_slice::<ToHelper>(&frame) else {
                continue;
            };
            if let ToHelper::Check { seq } = message {
                let (capture_ok, monitors) = probe();
                let answer = FromHelper::CheckResult {
                    seq,
                    capture_ok,
                    monitors,
                };
                if !send(conn, &answer) {
                    return "write failed";
                }
            } else if let Some(command) = command_of(message) {
                if commands.send(command).is_err() {
                    return "monitoring stopped";
                }
            }
        }
    }
}

/// A capture that is not black, and the monitors Windows reports.
fn probe() -> (bool, u32) {
    let capture_ok = match capture::grab(PROBE_WIDTH) {
        Ok(shot) => !capture::black_stats(&shot.bgra).is_black(),
        Err(error) => {
            tracing::warn!(%error, "test capture failed");
            false
        }
    };
    // SAFETY: no pointers involved.
    let monitors = unsafe { GetSystemMetrics(SM_CMONITORS) };
    (capture_ok, u32::try_from(monitors).unwrap_or(0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pipe_msg::MonitorPolicy;

    #[test]
    fn service_messages_become_focus_commands_and_a_check_does_not() {
        assert!(command_of(ToHelper::Check { seq: 1 }).is_none());
        assert!(matches!(
            command_of(ToHelper::MonitorStop),
            Some(Command::Stop)
        ));
        assert!(matches!(
            command_of(ToHelper::ExamWindow { hwnd: 5, pid: 6 }),
            Some(Command::ExamWindow { hwnd: 5, pid: 6 })
        ));
        let policy = MonitorPolicy {
            screenshot_on_switch: true,
            title_change_shots: true,
            periodic_outside_sec: 20,
            min_shot_gap_sec: 5,
            max_width: 1600,
            jpeg_quality: 60,
        };
        assert!(matches!(
            command_of(ToHelper::MonitorStart { policy }),
            Some(Command::Start(_))
        ));
    }
}
