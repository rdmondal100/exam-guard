//! Starts the agent's two pipes next to the helper supervisor: the app pipe (the student app talks
//! to it) and the helper pipe (the helper reports to it). Shared by the service and `--console`.
//! A ticker thread keeps the internet lease and starts the app again when it is gone (M24).

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::buffer::BufferRoot;
use crate::config;
use crate::evidence_queue::{EvidenceQueue, Stored};
use crate::helper_link::HelperLink;
use crate::net_control::{NetControl, NetStatus};
use crate::pipe_msg::{EvidenceBody, EvidenceData, LaunchRequest, MonitorPolicy};
use crate::pipe_security::{allowed_app, SDDL_APP_PIPE};
use crate::pipe_server::{Health, PipeServer, ServerConfig};
use crate::procwatch::ProcWatch;
use crate::relaunch::{LaunchSpec, Relauncher};
use crate::supervisor::Platform;
use crate::system_check::{evaluate, CheckResult};
use crate::wfp_engine::WfpBackend;

/// How long a system check waits for the helper's test capture.
const CHECK_TIMEOUT: Duration = Duration::from_millis(2500);

type Net = NetControl<WfpBackend>;
type LaunchApp = fn(u32, &LaunchSpec) -> Result<u32, String>;

struct AgentHealth {
    helper: Arc<HelperLink>,
    net: Arc<Net>,
    evidence: Arc<EvidenceQueue>,
    /// Which session is the student's (the process watcher looks only there).
    session: fn() -> Option<u32>,
    monitor: Mutex<MonitorState>,
    app: Mutex<AppPresence>,
}

#[derive(Default)]
struct MonitorState {
    /// The student the evidence in the queue belongs to.
    student: Option<String>,
    /// Running while monitoring is on.
    watch: Option<ProcWatch>,
    /// The exam app's process, from `exam.window`.
    exam_pid: u32,
}

/// Whether the student app is on the pipe, and how to start it again.
#[derive(Default)]
struct AppPresence {
    connections: u32,
    launch: Option<LaunchSpec>,
}

/// The first evidence number of this run. Counting up from the start time keeps the numbers (and the
/// dedupe keys built from them) unique across restarts of the agent.
fn first_evidence_seq() -> u64 {
    let ms = now_ms();
    ms.saturating_mul(1000)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(0))
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
        let mut state = self.monitor.lock().unwrap_or_else(PoisonError::into_inner);
        if state.student.as_deref() != Some(exam_student_id) {
            // Another student's evidence must never reach this one's session; this student's own
            // buffered evidence (from before an agent restart) is taken back.
            self.evidence.adopt(exam_student_id);
            state.watch = None;
            state.student = Some(exam_student_id.to_string());
        }
        // A repeated start (the app reconnected) keeps the running watch and its baseline.
        if state.watch.is_none() {
            let watch = ProcWatch::start(self.evidence.clone(), self.session);
            watch.set_exam_pid(state.exam_pid);
            state.watch = Some(watch);
        }
        self.helper.set_monitor(Some(policy.clone()));
    }

    fn monitor_stop(&self) {
        self.monitor
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .watch = None;
        self.helper.set_monitor(None);
    }

    fn exam_window(&self, hwnd: u64, pid: u32) {
        let mut state = self.monitor.lock().unwrap_or_else(PoisonError::into_inner);
        state.exam_pid = pid;
        if let Some(watch) = &state.watch {
            watch.set_exam_pid(pid);
        }
        drop(state);
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

    fn app_linked(&self, image: &Path, launch: Option<&LaunchRequest>) {
        let mut app = self.app.lock().unwrap_or_else(PoisonError::into_inner);
        app.connections += 1;
        if let Some(request) = launch {
            app.launch = Some(LaunchSpec::from_request(image, request));
        }
    }

    fn app_unlinked(&self) {
        let mut app = self.app.lock().unwrap_or_else(PoisonError::into_inner);
        app.connections = app.connections.saturating_sub(1);
    }
}

impl AgentHealth {
    fn app_connected(&self) -> bool {
        self.app
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .connections
            > 0
    }

    fn launch_spec(&self) -> Option<LaunchSpec> {
        self.app
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .launch
            .clone()
    }

    /// Starts the app in the student's session and records it as evidence.
    fn relaunch(&self, active_session: fn() -> Option<u32>, launch_app: LaunchApp) {
        let Some(spec) = self.launch_spec() else {
            tracing::warn!("the app is gone while monitoring, but it never said how to start it");
            return;
        };
        let Some(session) = active_session() else {
            return;
        };
        match launch_app(session, &spec) {
            Ok(pid) => {
                tracing::info!(pid, session, "app relaunched");
                let exe = spec
                    .exe
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned());
                self.evidence.push(EvidenceBody {
                    ts: now_ms(),
                    kind: "app_relaunched".into(),
                    data: EvidenceData {
                        exe,
                        pid: Some(pid),
                        ..EvidenceData::default()
                    },
                    screenshot: None,
                });
            }
            Err(error) => tracing::error!(%error, "could not relaunch the app"),
        }
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
    stop_ticker: Arc<AtomicBool>,
    ticker: JoinHandle<()>,
}

/// A few times a second: the internet lease (a block nobody renews ends by itself) and the app
/// relaunch.
fn spawn_ticker(
    health: Arc<AgentHealth>,
    platform: (fn() -> Option<u32>, LaunchApp),
    stop: Arc<AtomicBool>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        let (active_session, launch_app) = platform;
        let mut relauncher = Relauncher::default();
        while !stop.load(Ordering::SeqCst) {
            let now = Instant::now();
            health.net.tick(now);
            if relauncher.tick(now, health.monitoring(), health.app_connected()) {
                health.relaunch(active_session, launch_app);
            }
            thread::sleep(config::NET_TICK);
        }
    })
}

/// The evidence queue, on the encrypted disk buffer when its folder can be opened.
fn evidence_queue(platform: &Platform) -> EvidenceQueue {
    let dir = (platform.buffer_dir)();
    match BufferRoot::open(&dir, platform.buffer_sddl) {
        Ok(root) => EvidenceQueue::with_buffer(first_evidence_seq(), root),
        Err(error) => {
            tracing::error!(%error, dir = %dir.display(), "no evidence buffer; evidence stays in memory");
            EvidenceQueue::new(first_evidence_seq())
        }
    }
}

impl Link {
    pub fn start(platform: &Platform) -> Result<Self, String> {
        let evidence = Arc::new(evidence_queue(platform));
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
            session: platform.active_session,
            monitor: Mutex::new(MonitorState::default()),
            app: Mutex::new(AppPresence::default()),
        });
        match PipeServer::start(server, health.clone()) {
            Ok(app) => {
                let stop_ticker = Arc::new(AtomicBool::new(false));
                let ticker = spawn_ticker(
                    health,
                    (platform.active_session, platform.launch_app),
                    stop_ticker.clone(),
                );
                Ok(Self {
                    app,
                    helper,
                    net,
                    stop_ticker,
                    ticker,
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
        self.stop_ticker.store(true, Ordering::SeqCst);
        // The ticker only panics on a bug; the log has it.
        let _ = self.ticker.join();
        // The agent stopping must never leave the PC without internet.
        self.net.release();
        self.helper.stop();
    }
}
