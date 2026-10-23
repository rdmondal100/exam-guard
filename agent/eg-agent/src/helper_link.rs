//! Service side of the helper pipe `\\.\pipe\examguard-helper` (architecture §3): the helper connects
//! to the service, and the service asks it for a test capture when the app runs its system check.
//!
//! One worker owns the only instance of the pipe. A caller hands it a request through a channel and
//! waits for the reply, so there is never more than one conversation on the pipe.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use crate::pipe_conn::Conn;
use crate::pipe_frame::{encode, FrameBuffer};
use crate::pipe_msg::{FromHelper, ToHelper};
use crate::system_check::HelperReport;

struct Request {
    reply: Sender<Option<HelperReport>>,
}

pub struct HelperLink {
    name: String,
    requests: Mutex<Sender<Request>>,
    connected: Arc<AtomicBool>,
    stop: Arc<AtomicBool>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl HelperLink {
    pub fn start(name: &str, sddl: &str) -> Result<Self, String> {
        let conn = Conn::create_instance(name, sddl, true, 1)?;
        let (tx, rx) = mpsc::channel();
        let connected = Arc::new(AtomicBool::new(false));
        let stop = Arc::new(AtomicBool::new(false));
        let thread = {
            let (connected, stop) = (connected.clone(), stop.clone());
            thread::spawn(move || worker(&conn, &rx, &connected, &stop))
        };
        tracing::info!(pipe = name, "helper pipe listening");
        Ok(Self {
            name: name.to_string(),
            requests: Mutex::new(tx),
            connected,
            stop,
            thread: Mutex::new(Some(thread)),
        })
    }

    /// A helper is connected right now.
    pub fn alive(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }

    /// Asks the helper for a test capture. `None` when no helper is connected, it fails to answer
    /// within `timeout`, or the link breaks.
    pub fn check(&self, timeout: Duration) -> Option<HelperReport> {
        if !self.alive() {
            return None;
        }
        let (reply, answer) = mpsc::channel();
        self.requests.lock().ok()?.send(Request { reply }).ok()?;
        answer.recv_timeout(timeout).ok().flatten()
    }

    pub fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
        drop(Conn::connect(&self.name));
        let thread = self.thread.lock().ok().and_then(|mut slot| slot.take());
        if let Some(thread) = thread {
            // A worker only panics on a bug; the log has it.
            let _ = thread.join();
        }
    }
}

fn worker(conn: &Conn, requests: &Receiver<Request>, connected: &AtomicBool, stop: &AtomicBool) {
    while !stop.load(Ordering::SeqCst) {
        if let Err(error) = conn.wait_for_client() {
            tracing::warn!(%error, "waiting for the helper failed");
            thread::sleep(Duration::from_millis(200));
            continue;
        }
        if stop.load(Ordering::SeqCst) {
            break;
        }
        // Requests from before this helper came are stale; their callers have given up.
        while requests.try_recv().is_ok() {}
        connected.store(true, Ordering::SeqCst);
        tracing::info!("helper connected");
        let reason = converse(conn, requests, stop);
        connected.store(false, Ordering::SeqCst);
        tracing::info!(reason, "helper disconnected");
        conn.disconnect();
    }
}

fn converse(conn: &Conn, requests: &Receiver<Request>, stop: &AtomicBool) -> &'static str {
    let mut seq = 0u64;
    let mut frames = FrameBuffer::default();
    while !stop.load(Ordering::SeqCst) {
        match requests.recv_timeout(Duration::from_millis(100)) {
            Err(RecvTimeoutError::Timeout) => {
                if conn.available().is_err() {
                    return "pipe closed";
                }
            }
            Err(RecvTimeoutError::Disconnected) => return "service stopping",
            Ok(request) => {
                seq += 1;
                let report = ask(conn, &mut frames, seq);
                let failed = report.is_none();
                // The caller may have timed out and left; nothing to do then.
                let _ = request.reply.send(report);
                if failed {
                    return "no answer";
                }
            }
        }
    }
    "service stopping"
}

/// Sends one `check` and reads until its `check.result` arrives or the helper stops answering.
fn ask(conn: &Conn, frames: &mut FrameBuffer, seq: u64) -> Option<HelperReport> {
    let json = serde_json::to_vec(&ToHelper::Check { seq }).ok()?;
    conn.write_all(&encode(&json).ok()?).ok()?;
    let give_up = Instant::now() + Duration::from_secs(5);
    let mut chunk = [0u8; 1024];
    while Instant::now() < give_up {
        while let Ok(Some(frame)) = frames.next_frame() {
            if let Ok(FromHelper::CheckResult {
                seq: answered,
                capture_ok,
                monitors,
            }) = serde_json::from_slice(&frame)
            {
                if answered == seq {
                    return Some(HelperReport {
                        capture_ok,
                        monitors,
                    });
                }
            }
        }
        match conn.available() {
            Err(_) => return None,
            Ok(0) => thread::sleep(Duration::from_millis(5)),
            Ok(_) => match conn.read(&mut chunk) {
                Ok(n) if n > 0 => frames.push(&chunk[..n]),
                _ => return None,
            },
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pipe_frame::FrameBuffer;
    use std::sync::atomic::AtomicU32;

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    fn unique_name() -> String {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        format!(r"\\.\pipe\eg-helper-test-{}-{n}", std::process::id())
    }

    /// A stand-in for the helper: answers every `check` with the given report.
    fn fake_helper(name: &str, report: HelperReport) -> JoinHandle<()> {
        let conn = Conn::connect(name).unwrap();
        thread::spawn(move || {
            let mut frames = FrameBuffer::default();
            let mut chunk = [0u8; 1024];
            while let Ok(n) = conn.read(&mut chunk) {
                if n == 0 {
                    return;
                }
                frames.push(&chunk[..n]);
                while let Ok(Some(frame)) = frames.next_frame() {
                    let Ok(ToHelper::Check { seq }) = serde_json::from_slice(&frame) else {
                        continue;
                    };
                    let answer = FromHelper::CheckResult {
                        seq,
                        capture_ok: report.capture_ok,
                        monitors: report.monitors,
                    };
                    let wire = encode(&serde_json::to_vec(&answer).unwrap()).unwrap();
                    if conn.write_all(&wire).is_err() {
                        return;
                    }
                }
            }
        })
    }

    fn wait_until(what: &str, condition: impl Fn() -> bool) {
        let give_up = Instant::now() + Duration::from_secs(3);
        while !condition() {
            assert!(Instant::now() < give_up, "timed out waiting for {what}");
            thread::sleep(Duration::from_millis(5));
        }
    }

    #[test]
    fn without_a_helper_there_is_nothing_to_report() {
        let link = HelperLink::start(&unique_name(), "D:(A;;FA;;;WD)").unwrap();
        assert!(!link.alive());
        assert_eq!(link.check(Duration::from_millis(200)), None);
        link.stop();
    }

    #[test]
    fn a_connected_helper_answers_a_check() {
        let name = unique_name();
        let link = HelperLink::start(&name, "D:(A;;FA;;;WD)").unwrap();
        let helper = fake_helper(
            &name,
            HelperReport {
                capture_ok: true,
                monitors: 3,
            },
        );
        wait_until("the helper to connect", || link.alive());
        let report = link.check(Duration::from_secs(2)).unwrap();
        assert_eq!(
            report,
            HelperReport {
                capture_ok: true,
                monitors: 3
            }
        );
        assert!(link.check(Duration::from_secs(2)).is_some());
        link.stop();
        let _ = helper.join();
    }

    #[test]
    fn a_helper_that_goes_away_is_noticed_and_a_new_one_is_accepted() {
        let name = unique_name();
        let link = HelperLink::start(&name, "D:(A;;FA;;;WD)").unwrap();
        let report = HelperReport {
            capture_ok: true,
            monitors: 1,
        };
        let first = Conn::connect(&name).unwrap();
        wait_until("the helper to connect", || link.alive());
        drop(first);
        wait_until("the helper to be missed", || !link.alive());
        assert_eq!(link.check(Duration::from_millis(100)), None);

        // The worker listens again within a poll; the real helper retries every 500 ms.
        let give_up = Instant::now() + Duration::from_secs(2);
        let helper = loop {
            match std::panic::catch_unwind(|| fake_helper(&name, report)) {
                Ok(helper) => break helper,
                Err(_) => {
                    assert!(Instant::now() < give_up, "the new helper never got in");
                    thread::sleep(Duration::from_millis(20));
                }
            }
        };
        wait_until("the new helper to connect", || link.alive());
        assert_eq!(link.check(Duration::from_secs(2)), Some(report));
        link.stop();
        let _ = helper.join();
    }
}
