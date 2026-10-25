//! Starts the agent's two pipes next to the helper supervisor: the app pipe (the student app talks
//! to it) and the helper pipe (the helper reports to it). Shared by the service and `--console`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use crate::config;
use crate::helper_link::HelperLink;
use crate::net_control::{NetControl, NetStatus};
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
        let helper = Arc::new(HelperLink::start(
            config::HELPER_PIPE,
            platform.helper_pipe_sddl,
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
