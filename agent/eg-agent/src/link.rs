//! Starts the agent's two pipes next to the helper supervisor: the app pipe (the student app talks
//! to it) and the helper pipe (the helper reports to it). Shared by the service and `--console`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::config;
use crate::evidence_queue::{EvidenceQueue, Stored};
use crate::helper_link::HelperLink;
use crate::net_control::{NetControl, NetStatus};
use crate::pipe_msg::MonitorPolicy;
use crate::pipe_security::{allowed_app, SDDL_APP_PIPE};
use crate::pipe_server::{Health, PipeServer, ServerConfig};
use crate::supervisor::Platform;
use crate::system_check::{evaluate, CheckResult};
use crate::wfp_engine::WfpBackend;

/// How long a system check waits for the helper's test capture.
const CHECK_TIMEOUT: Duration = Duration::from_millis(2500);

type Net = NetControl<WfpBackend>;

struct AgentHealth {
    helper: Arc<HelperLink>,
    net: Arc<Net>,
    evidence: Arc<EvidenceQueue>,
    /// The student the evidence in the queue belongs to.
    student: Mutex<Option<String>>,
}

/// The first evidence number of this run. Counting up from the start time keeps the numbers (and the
/// dedupe keys built from them) unique across restarts of the agent.
fn first_evidence_seq() -> u64 {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(0));
    ms.saturating_mul(1000)
}

impl Health for AgentHealth {
    fn helper_alive(&self) -> bool {
        self.helper.alive()
    }

    fn system_check(&self) -> CheckResult {
        evaluate(self.helper.check(CHECK_TIMEOUT))
    }

    fn net_set(&self, blocked: bool, allow: &[String]) -> NetStatus {
        self.net.set(blocked, allow, Instant::now())
    }

    fn monitor_start(&self, exam_student_id: &str, policy: &MonitorPolicy) {
        let mut student = self.student.lock().unwrap_or_else(PoisonError::into_inner);
        if student.as_deref() != Some(exam_student_id) {
            // Another student's evidence must never reach this one's session.
            self.evidence.clear();
            *student = Some(exam_student_id.to_string());
        }
        self.helper.set_monitor(Some(policy.clone()));
    }

    fn monitor_stop(&self) {
        self.helper.set_monitor(None);
    }

    fn exam_window(&self, hwnd: u64, pid: u32) {
        self.helper.set_window(hwnd, pid);
    }

    fn monitoring(&self) -> bool {
        self.helper.monitoring()
    }

    fn evidence_after(&self, after: u64) -> Vec<Stored> {
        self.evidence.after(after)
    }

    fn evidence_ack(&self, up_to: u64) {
        self.evidence.ack(up_to);
    }
}

/// Runs `body` (the helper supervisor) with the pipes open. A pipe that cannot start is logged and
/// does not stop the supervisor: the app then finds no agent, which is what it should report.
pub fn run_with_link<T>(platform: &Platform, body: impl FnOnce() -> T) -> T {
    let link = match Link::start(platform) {
        Ok(link) => Some(link),
        Err(error) => {
            tracing::error!(%error, "the agent pipes did not start");
            None
        }
    };
    let result = body();
    if let Some(link) = link {
        link.stop();
    }
    result
}

pub struct Link {
    app: PipeServer,
    helper: Arc<HelperLink>,
    net: Arc<Net>,
    stop_lease: Arc<AtomicBool>,
    lease_timer: JoinHandle<()>,
}

/// Checks the internet lease a few times a second, so a block nobody renews ends by itself.
fn spawn_lease_timer(net: Arc<Net>, stop: Arc<AtomicBool>) -> JoinHandle<()> {
    thread::spawn(move || {
        while !stop.load(Ordering::SeqCst) {
            net.tick(Instant::now());
            thread::sleep(config::NET_TICK);
        }
    })
}

impl Link {
    pub fn start(platform: &Platform) -> Result<Self, String> {
        let evidence = Arc::new(EvidenceQueue::new(first_evidence_seq()));
        let helper = Arc::new(HelperLink::start(
            config::HELPER_PIPE,
            platform.helper_pipe_sddl,
            evidence.clone(),
        )?);
        let allow_env = platform.allow_env_app;
        let server = ServerConfig {
            name: config::APP_PIPE.to_string(),
            sddl: SDDL_APP_PIPE.to_string(),
            instances: config::APP_PIPE_INSTANCES,
            allowed_app: Arc::new(move || allowed_app(allow_env)),
            heartbeat: config::HEARTBEAT,
            lost_after: config::HEARTBEAT_LOST,
            hello_within: config::HELLO_WITHIN,
        };
        let net = Arc::new(NetControl::new(WfpBackend::default(), config::NET_LEASE));
        let health = Arc::new(AgentHealth {
            helper: helper.clone(),
            net: net.clone(),
            evidence,
            student: Mutex::new(None),
        });
        match PipeServer::start(server, health) {
            Ok(app) => {
                let stop_lease = Arc::new(AtomicBool::new(false));
                let lease_timer = spawn_lease_timer(net.clone(), stop_lease.clone());
                Ok(Self {
                    app,
                    helper,
                    net,
                    stop_lease,
                    lease_timer,
                })
            }
            Err(error) => {
                helper.stop();
                Err(error)
            }
        }
    }

    pub fn stop(self) {
        self.app.stop();
        self.stop_lease.store(true, Ordering::SeqCst);
        // The timer only panics on a bug; the log has it.
        let _ = self.lease_timer.join();
        // The agent stopping must never leave the PC without internet.
        self.net.release();
        self.helper.stop();
    }
}
