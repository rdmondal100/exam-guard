//! Service side of the helper pipe `\\.\pipe\examguard-helper` (architecture §3): the helper connects
//! to the service. The service asks it for a test capture when the app runs its system check, tells
//! it what to monitor, and receives its evidence.
//!
//! One worker owns the only instance of the pipe, so there is never more than one conversation on
//! it. A caller hands the worker a request through a channel and waits for the reply. The monitoring
//! state the app asked for is kept here and sent to every helper that connects, so a restarted
//! helper picks up where the last one was.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use crate::evidence_queue::EvidenceQueue;
use crate::pipe_conn::Conn;
use crate::pipe_frame::{encode, FrameBuffer};
use crate::pipe_msg::{FromHelper, MonitorPolicy, ToHelper};
use crate::system_check::HelperReport;

/// How long the worker waits for a request before it looks at the pipe and the monitoring state.
const IDLE: Duration = Duration::from_millis(20);

struct Request {
    reply: Sender<Option<HelperReport>>,
}

/// What the helper should be doing. `generation` changes with every edit.
#[derive(Default)]
struct Desired {
    generation: u64,
    monitor: Option<MonitorPolicy>,
    window: Option<(u64, u32)>,
}

struct Shared {
    connected: AtomicBool,
    stop: AtomicBool,
    desired: Mutex<Desired>,
    evidence: Arc<EvidenceQueue>,
}

pub struct HelperLink {
    name: String,
    requests: Mutex<Sender<Request>>,
    shared: Arc<Shared>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl HelperLink {
    pub fn start(name: &str, sddl: &str, evidence: Arc<EvidenceQueue>) -> Result<Self, String> {
        let conn = Conn::create_instance(name, sddl, true, 1)?;
        let (tx, rx) = mpsc::channel();
        let shared = Arc::new(Shared {
            connected: AtomicBool::new(false),
            stop: AtomicBool::new(false),
            desired: Mutex::new(Desired::default()),
            evidence,
        });
        let thread = {
            let shared = shared.clone();
            thread::spawn(move || worker(&conn, &rx, &shared))
        };
        tracing::info!(pipe = name, "helper pipe listening");
        Ok(Self {
            name: name.to_string(),
            requests: Mutex::new(tx),
            shared,
            thread: Mutex::new(Some(thread)),
        })
    }

    /// A helper is connected right now.
    pub fn alive(&self) -> bool {
        self.shared.connected.load(Ordering::SeqCst)
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

    fn edit(&self, change: impl FnOnce(&mut Desired)) {
        let mut desired = self
            .shared
            .desired
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        change(&mut desired);
        desired.generation += 1;
    }

    /// Monitor with this policy, or stop monitoring (`None`).
    pub fn set_monitor(&self, policy: Option<MonitorPolicy>) {
        self.edit(|desired| desired.monitor = policy);
    }

    /// The exam window: the helper counts it, and what it started, as inside.
    pub fn set_window(&self, hwnd: u64, pid: u32) {
        self.edit(|desired| desired.window = Some((hwnd, pid)));
    }

    /// The app asked for monitoring and has not stopped it.
    pub fn monitoring(&self) -> bool {
        self.shared
            .desired
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .monitor
            .is_some()
    }

    pub fn stop(&self) {
        self.shared.stop.store(true, Ordering::SeqCst);
        drop(Conn::connect(&self.name));
        let thread = self.thread.lock().ok().and_then(|mut slot| slot.take());
        if let Some(thread) = thread {
            // A worker only panics on a bug; the log has it.
            let _ = thread.join();
        }
    }
}

fn worker(conn: &Conn, requests: &Receiver<Request>, shared: &Shared) {
    while !shared.stop.load(Ordering::SeqCst) {
        if let Err(error) = conn.wait_for_client() {
            tracing::warn!(%error, "waiting for the helper failed");
            thread::sleep(Duration::from_millis(200));
            continue;
        }
        if shared.stop.load(Ordering::SeqCst) {
            break;
        }
        // Requests from before this helper came are stale; their callers have given up.
        while requests.try_recv().is_ok() {}
        shared.connected.store(true, Ordering::SeqCst);
        tracing::info!("helper connected");
        let reason = converse(conn, requests, shared);
        shared.connected.store(false, Ordering::SeqCst);
        tracing::info!(reason, "helper disconnected");
        conn.disconnect();
    }
}

fn write(conn: &Conn, message: &ToHelper) -> bool {
    let Ok(json) = serde_json::to_vec(message) else {
        return false;
    };
    let Ok(wire) = encode(&json) else {
        return false;
    };
    conn.write_all(&wire).is_ok()
}

/// Sends the monitoring state when it changed since the last time on this connection.
fn push_desired(conn: &Conn, shared: &Shared, sent: &mut u64) -> bool {
    let (generation, messages) = {
        let desired = shared
            .desired
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        if desired.generation == *sent {
            return true;
        }
        let mut messages = Vec::new();
        if let Some((hwnd, pid)) = desired.window {
            messages.push(ToHelper::ExamWindow { hwnd, pid });
        }
        messages.push(match &desired.monitor {
            Some(policy) => ToHelper::MonitorStart {
                policy: policy.clone(),
            },
            None => ToHelper::MonitorStop,
        });
        (desired.generation, messages)
    };
    *sent = generation;
    messages.iter().all(|message| write(conn, message))
}

/// Keeps what the helper volunteers (evidence); returns the answer when the frame is a check result.
fn handle_frame(frame: &[u8], evidence: &EvidenceQueue) -> Option<(u64, HelperReport)> {
    match serde_json::from_slice(frame) {
        Ok(FromHelper::CheckResult {
            seq,
            capture_ok,
            monitors,
        }) => Some((
            seq,
            HelperReport {
                capture_ok,
                monitors,
            },
        )),
        Ok(FromHelper::Evidence { body }) => {
            let evidence_seq = evidence.push(body);
            tracing::debug!(evidence_seq, "evidence from the helper");
            None
        }
        Err(_) => None,
    }
}

/// Reads whatever the helper has sent. `false` when the pipe is gone.
fn drain(conn: &Conn, frames: &mut FrameBuffer, evidence: &EvidenceQueue) -> bool {
    let mut chunk = [0u8; 16 * 1024];
    loop {
        match conn.available() {
            Err(_) => return false,
            Ok(0) => break,
            Ok(_) => match conn.read(&mut chunk) {
                Ok(n) if n > 0 => frames.push(&chunk[..n]),
                _ => return false,
            },
        }
        while let Ok(Some(frame)) = frames.next_frame() {
            handle_frame(&frame, evidence);
        }
    }
    while let Ok(Some(frame)) = frames.next_frame() {
        handle_frame(&frame, evidence);
    }
    true
}

fn converse(conn: &Conn, requests: &Receiver<Request>, shared: &Shared) -> &'static str {
    let mut seq = 0u64;
    let mut sent = 0u64;
    let mut frames = FrameBuffer::default();
    while !shared.stop.load(Ordering::SeqCst) {
        if !push_desired(conn, shared, &mut sent) {
            return "write failed";
        }
        match requests.recv_timeout(IDLE) {
            Err(RecvTimeoutError::Timeout) => {
                if !drain(conn, &mut frames, &shared.evidence) {
                    return "pipe closed";
                }
            }
            Err(RecvTimeoutError::Disconnected) => return "service stopping",
            Ok(request) => {
                seq += 1;
                let report = ask(conn, &mut frames, seq, &shared.evidence);
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
fn ask(
    conn: &Conn,
    frames: &mut FrameBuffer,
    seq: u64,
    evidence: &EvidenceQueue,
) -> Option<HelperReport> {
    let json = serde_json::to_vec(&ToHelper::Check { seq }).ok()?;
    conn.write_all(&encode(&json).ok()?).ok()?;
    let give_up = Instant::now() + Duration::from_secs(5);
    let mut chunk = [0u8; 16 * 1024];
    while Instant::now() < give_up {
        while let Ok(Some(frame)) = frames.next_frame() {
            if let Some((answered, report)) = handle_frame(&frame, evidence) {
                if answered == seq {
                    return Some(report);
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
    use crate::pipe_msg::{EvidenceBody, EvidenceData};
    use std::sync::atomic::AtomicU32;

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    fn unique_name() -> String {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        format!(r"\\.\pipe\eg-helper-test-{}-{n}", std::process::id())
    }

    fn start(name: &str) -> (HelperLink, Arc<EvidenceQueue>) {
        let queue = Arc::new(EvidenceQueue::new(1));
        let link = HelperLink::start(name, "D:(A;;FA;;;WD)", queue.clone()).unwrap();
        (link, queue)
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

    fn policy() -> MonitorPolicy {
        MonitorPolicy {
            screenshot_on_switch: true,
            title_change_shots: true,
            periodic_outside_sec: 20,
            min_shot_gap_sec: 5,
            max_width: 1600,
            jpeg_quality: 60,
        }
    }

    fn evidence_body() -> EvidenceBody {
        EvidenceBody {
            ts: 5,
            kind: "focus_lost".into(),
            data: EvidenceData::default(),
            screenshot: None,
        }
    }

    /// Reads helper-pipe messages the service sent, polling without blocking.
    fn read_messages(conn: &Conn, frames: &mut FrameBuffer, want: usize) -> Vec<ToHelper> {
        let mut got = Vec::new();
        let give_up = Instant::now() + Duration::from_secs(3);
        while got.len() < want && Instant::now() < give_up {
            while let Some(frame) = frames.next_frame().unwrap() {
                got.push(serde_json::from_slice(&frame).unwrap());
            }
            if got.len() >= want {
                break;
            }
            if conn.available().unwrap() == 0 {
                thread::sleep(Duration::from_millis(5));
                continue;
            }
            let mut chunk = [0u8; 4096];
            let n = conn.read(&mut chunk).unwrap();
            frames.push(&chunk[..n]);
        }
        got
    }

    #[test]
    fn without_a_helper_there_is_nothing_to_report() {
        let (link, _) = start(&unique_name());
        assert!(!link.alive());
        assert_eq!(link.check(Duration::from_millis(200)), None);
        link.stop();
    }

    #[test]
    fn a_connected_helper_answers_a_check() {
        let name = unique_name();
        let (link, _) = start(&name);
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
        let (link, _) = start(&name);
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

    #[test]
    fn evidence_the_helper_volunteers_is_queued() {
        let name = unique_name();
        let (link, queue) = start(&name);
        let helper = Conn::connect(&name).unwrap();
        let wire = encode(
            &serde_json::to_vec(&FromHelper::Evidence {
                body: evidence_body(),
            })
            .unwrap(),
        )
        .unwrap();
        helper.write_all(&wire).unwrap();
        wait_until("the evidence to arrive", || queue.len() == 1);
        assert_eq!(queue.after(0)[0].body.kind, "focus_lost");
        link.stop();
    }

    #[test]
    fn the_monitoring_state_reaches_a_helper_that_connects_later_and_changes_follow() {
        let name = unique_name();
        let (link, _) = start(&name);
        assert!(!link.monitoring());
        link.set_window(66012, 4100);
        link.set_monitor(Some(policy()));
        assert!(link.monitoring());

        let helper = Conn::connect(&name).unwrap();
        let mut frames = FrameBuffer::default();
        let first = read_messages(&helper, &mut frames, 2);
        assert_eq!(first[0], ToHelper::ExamWindow { hwnd: 66012, pid: 4100 });
        assert_eq!(first[1], ToHelper::MonitorStart { policy: policy() });

        link.set_monitor(None);
        assert!(!link.monitoring());
        let next = read_messages(&helper, &mut frames, 2);
        assert_eq!(next[1], ToHelper::MonitorStop);
        link.stop();
    }
}
