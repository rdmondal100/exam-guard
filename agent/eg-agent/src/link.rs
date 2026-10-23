//! Starts the agent's two pipes next to the helper supervisor: the app pipe (the student app talks
//! to it) and the helper pipe (the helper reports to it). Shared by the service and `--console`.

use std::sync::Arc;
use std::time::Duration;

use crate::config;
use crate::helper_link::HelperLink;
use crate::pipe_security::{allowed_app, SDDL_APP_PIPE};
use crate::pipe_server::{Health, PipeServer, ServerConfig};
use crate::supervisor::Platform;
use crate::system_check::{evaluate, CheckResult};

/// How long a system check waits for the helper's test capture.
const CHECK_TIMEOUT: Duration = Duration::from_millis(2500);

struct AgentHealth {
    helper: Arc<HelperLink>,
}

impl Health for AgentHealth {
    fn helper_alive(&self) -> bool {
        self.helper.alive()
    }

    fn system_check(&self) -> CheckResult {
        evaluate(self.helper.check(CHECK_TIMEOUT))
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
        let health = Arc::new(AgentHealth {
            helper: helper.clone(),
        });
        match PipeServer::start(server, health) {
            Ok(app) => Ok(Self { app, helper }),
            Err(error) => {
                helper.stop();
                Err(error)
            }
        }
    }

    pub fn stop(self) {
        self.app.stop();
        self.helper.stop();
    }
}
