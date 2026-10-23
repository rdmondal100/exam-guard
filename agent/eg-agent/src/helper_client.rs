//! The helper's side of the helper pipe: connects to the service, and answers each `check` with a
//! test capture and the number of monitors. The service reconnects nothing; this loop does.

use std::thread::{self, JoinHandle};
use std::time::Duration;

use windows_sys::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CMONITORS};

use crate::pipe_conn::Conn;
use crate::pipe_frame::{encode, FrameBuffer};
use crate::pipe_msg::{FromHelper, ToHelper};
use crate::{capture, config};

const RETRY: Duration = Duration::from_millis(500);
/// The test capture is only checked for black, so a small one is enough and quick.
const PROBE_WIDTH: u32 = 640;

pub fn spawn() -> JoinHandle<()> {
    thread::spawn(|| loop {
        match Conn::connect(config::HELPER_PIPE) {
            Ok(conn) => {
                tracing::info!("connected to the service");
                let reason = serve(&conn);
                tracing::warn!(reason, "service link ended");
            }
            Err(error) => tracing::debug!(%error, "service not reachable yet"),
        }
        thread::sleep(RETRY);
    })
}

fn serve(conn: &Conn) -> &'static str {
    let mut frames = FrameBuffer::default();
    let mut chunk = [0u8; 1024];
    loop {
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
            let Ok(ToHelper::Check { seq }) = serde_json::from_slice(&frame) else {
                continue;
            };
            let (capture_ok, monitors) = probe();
            let answer = FromHelper::CheckResult {
                seq,
                capture_ok,
                monitors,
            };
            let Ok(json) = serde_json::to_vec(&answer) else {
                continue;
            };
            let Ok(wire) = encode(&json) else { continue };
            if conn.write_all(&wire).is_err() {
                return "write failed";
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
