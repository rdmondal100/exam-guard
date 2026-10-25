//! The app pipe `\\.\pipe\examguard-agent` (docs/protocol.md §4, architecture §3).
//!
//! The server creates every pipe instance itself, up front, and each worker keeps its instance for
//! good (it disconnects and listens again, it never closes). `max_instances` equals the number of
//! instances, so no other process can ever create one and a client can only reach this server.
//! A connecting process must be the registered student app; anything else is cut off before it
//! can send a byte. A verified app gets a hello, answers to `system.check`, and a heartbeat every
//! `heartbeat`; no ack for `lost_after` ends the connection.

use std::io;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use crate::net_control::NetStatus;
use crate::pipe_conn::Conn;
use crate::pipe_frame::{encode, FrameBuffer};
use crate::pipe_msg::{FromApp, ToApp};
use crate::pipe_security::{image_path, same_image};
use crate::system_check::CheckResult;

pub const PIPE_VERSION: u32 = 1;
const POLL: Duration = Duration::from_millis(10);

/// What the pipe needs to know about the rest of the agent.
pub trait Health: Send + Sync {
    fn helper_alive(&self) -> bool;
    /// A fresh check; may take a moment (the helper takes a test capture).
    fn system_check(&self) -> CheckResult;
    /// The app's `net.set`: block the internet except `allow`, or stop blocking.
    fn net_set(&self, blocked: bool, allow: &[String]) -> NetStatus {
        let _ = (blocked, allow);
        NetStatus {
            blocked: false,
            error: Some("This agent cannot control the internet.".to_string()),
        }
    }
}

#[derive(Clone)]
pub struct ServerConfig {
    pub name: String,
    pub sddl: String,
    /// Instances, and so connections served at once. One is enough for the app; the others only
    /// keep the name occupied and absorb a second copy of the app.
    pub instances: u32,
    /// Looked up at each connection, so a registry change needs no restart.
    pub allowed_app: Arc<dyn Fn() -> Option<PathBuf> + Send + Sync>,
    pub heartbeat: Duration,
    pub lost_after: Duration,
    /// A verified app must say hello within this time.
    pub hello_within: Duration,
}

pub struct PipeServer {
    name: String,
    stop: Arc<AtomicBool>,
    threads: Vec<JoinHandle<()>>,
}

impl PipeServer {
    pub fn start(config: ServerConfig, health: Arc<dyn Health>) -> Result<Self, String> {
        let mut instances = Vec::new();
        for index in 0..config.instances {
            instances.push(Conn::create_instance(
                &config.name,
                &config.sddl,
                index == 0,
                config.instances,
            )?);
        }
        let stop = Arc::new(AtomicBool::new(false));
        let threads = instances
            .into_iter()
            .map(|conn| {
                let (config, health, stop) = (config.clone(), health.clone(), stop.clone());
                thread::spawn(move || worker(&conn, &config, health.as_ref(), &stop))
            })
            .collect();
        tracing::info!(pipe = %config.name, instances = config.instances, "app pipe listening");
        Ok(Self {
            name: config.name,
            stop,
            threads,
        })
    }

    /// Ends every connection and waits for the workers.
    pub fn stop(self) {
        self.stop.store(true, Ordering::SeqCst);
        // A worker waits for a client inside `ConnectNamedPipe`; a connection of our own wakes it.
        for _ in &self.threads {
            drop(Conn::connect(&self.name));
        }
        for thread in self.threads {
            // A worker only panics on a bug; the log has it.
            let _ = thread.join();
        }
        tracing::info!("app pipe stopped");
    }
}

fn worker(conn: &Conn, config: &ServerConfig, health: &dyn Health, stop: &AtomicBool) {
    while !stop.load(Ordering::SeqCst) {
        if let Err(error) = conn.wait_for_client() {
            tracing::warn!(%error, "waiting for a pipe client failed");
            thread::sleep(Duration::from_millis(200));
            continue;
        }
        if stop.load(Ordering::SeqCst) {
            break;
        }
        match verify_peer(conn, config) {
            Ok(pid) => {
                tracing::info!(pid, "app connected");
                let reason = serve(conn, config, health, stop);
                tracing::info!(pid, reason, "app connection ended");
            }
            Err(reason) => tracing::warn!(reason, "rejected pipe peer"),
        }
        conn.disconnect();
    }
}

/// The connecting process must be the registered student app.
fn verify_peer(conn: &Conn, config: &ServerConfig) -> Result<u32, String> {
    let pid = conn.client_pid().ok_or("the client process is unknown")?;
    let allowed = (config.allowed_app)().ok_or("no student app is registered")?;
    let image = image_path(pid).ok_or_else(|| format!("pid {pid}: program file unreadable"))?;
    if same_image(&image, &allowed) {
        Ok(pid)
    } else {
        Err(format!(
            "pid {pid} runs {}, not {}",
            image.display(),
            allowed.display()
        ))
    }
}

fn send(conn: &Conn, message: &ToApp) -> io::Result<()> {
    let json = serde_json::to_vec(message).map_err(io::Error::other)?;
    let wire = encode(&json).map_err(io::Error::other)?;
    conn.write_all(&wire)
}

/// Serves one verified connection; the returned text says why it ended.
fn serve(
    conn: &Conn,
    config: &ServerConfig,
    health: &dyn Health,
    stop: &AtomicBool,
) -> &'static str {
    let mut seq = 0u64;
    let mut next_seq = || {
        seq += 1;
        seq
    };
    let hello = ToApp::Hello {
        seq: next_seq(),
        pipe_version: PIPE_VERSION,
        agent_version: env!("CARGO_PKG_VERSION").to_string(),
        pid: std::process::id(),
        helper: health.helper_alive(),
    };
    if send(conn, &hello).is_err() {
        return "write failed";
    }

    let started = Instant::now();
    let mut frames = FrameBuffer::default();
    let mut greeted = false;
    let mut last_ack = started;
    let mut next_heartbeat = started;
    let mut heartbeat_seq = 0u64;
    let mut chunk = [0u8; 4096];

    loop {
        if stop.load(Ordering::SeqCst) {
            return "agent stopping";
        }
        let waiting = match conn.available() {
            Ok(n) => n,
            Err(_) => return "app closed the pipe",
        };
        if waiting > 0 {
            match conn.read(&mut chunk) {
                Ok(0) | Err(_) => return "app closed the pipe",
                Ok(n) => frames.push(&chunk[..n]),
            }
        }
        loop {
            let frame = match frames.next_frame() {
                Ok(Some(frame)) => frame,
                Ok(None) => break,
                Err(_) => return "oversized frame",
            };
            let reply = match serde_json::from_slice::<FromApp>(&frame) {
                Ok(FromApp::Hello { pipe_version, .. }) if pipe_version != PIPE_VERSION => {
                    let error = error(next_seq(), "pipe_version", "unsupported pipe version");
                    let _ = send(conn, &error);
                    return "pipe version mismatch";
                }
                Ok(FromApp::Hello { .. }) => {
                    greeted = true;
                    last_ack = Instant::now();
                    next_heartbeat = Instant::now();
                    None
                }
                Ok(_) if !greeted => Some(error(next_seq(), "no_hello", "say hello first")),
                Ok(FromApp::SystemCheck { seq: req_seq }) => {
                    let check = health.system_check();
                    Some(ToApp::SystemCheckResult {
                        seq: next_seq(),
                        req_seq,
                        ok: check.ok,
                        helper: check.helper,
                        capture_ok: check.capture_ok,
                        monitors: check.monitors,
                        problems: check.problems,
                    })
                }
                Ok(FromApp::NetSet {
                    seq: req_seq,
                    blocked,
                    allow,
                }) => {
                    let status = health.net_set(blocked, &allow);
                    Some(ToApp::NetStatus {
                        seq: next_seq(),
                        req_seq,
                        blocked: status.blocked,
                        error: status.error,
                    })
                }
                Ok(FromApp::HeartbeatAck { .. }) => {
                    last_ack = Instant::now();
                    None
                }
                Err(_) => Some(error(next_seq(), "bad_message", "not a message I know")),
            };
            if let Some(reply) = reply {
                if send(conn, &reply).is_err() {
                    return "write failed";
                }
            }
        }

        let now = Instant::now();
        if !greeted && now.duration_since(started) > config.hello_within {
            return "no hello from the app";
        }
        if greeted {
            if now.duration_since(last_ack) > config.lost_after {
                return "no heartbeat ack";
            }
            if now >= next_heartbeat {
                let beat = ToApp::Heartbeat {
                    seq: next_seq(),
                    hb_seq: heartbeat_seq,
                    helper: health.helper_alive(),
                    monitoring: false,
                };
                heartbeat_seq += 1;
                next_heartbeat = now + config.heartbeat;
                if send(conn, &beat).is_err() {
                    return "write failed";
                }
            }
        }
        if waiting == 0 {
            thread::sleep(POLL);
        }
    }
}

fn error(seq: u64, code: &str, message: &str) -> ToApp {
    ToApp::Error {
        seq,
        code: code.to_string(),
        message: message.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicU32;

    const TEST_SDDL: &str = "D:(A;;FA;;;WD)";
    static COUNTER: AtomicU32 = AtomicU32::new(0);

    struct FakeHealth {
        check: CheckResult,
    }

    impl Health for FakeHealth {
        fn helper_alive(&self) -> bool {
            self.check.helper
        }
        fn system_check(&self) -> CheckResult {
            self.check.clone()
        }
        fn net_set(&self, blocked: bool, allow: &[String]) -> NetStatus {
            NetStatus {
                blocked: blocked && !allow.is_empty(),
                error: allow.is_empty().then(|| "no address".to_string()),
            }
        }
    }

    fn good_check() -> CheckResult {
        CheckResult {
            ok: true,
            helper: true,
            capture_ok: true,
            monitors: 2,
            problems: vec![],
        }
    }

    fn unique_name() -> String {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        format!(r"\\.\pipe\eg-test-{}-{n}", std::process::id())
    }

    fn start(allowed: Option<PathBuf>, check: CheckResult) -> PipeServer {
        let config = ServerConfig {
            name: unique_name(),
            sddl: TEST_SDDL.to_string(),
            instances: 2,
            allowed_app: Arc::new(move || allowed.clone()),
            heartbeat: Duration::from_millis(50),
            lost_after: Duration::from_millis(400),
            hello_within: Duration::from_millis(400),
        };
        PipeServer::start(config, Arc::new(FakeHealth { check })).unwrap()
    }

    fn me() -> Option<PathBuf> {
        Some(std::env::current_exe().unwrap())
    }

    fn put(conn: &Conn, json: &str) {
        conn.write_all(&encode(json.as_bytes()).unwrap()).unwrap();
    }

    /// The next message, or `None` when the server closed the pipe or nothing came in 3 s.
    fn next(conn: &Conn, frames: &mut FrameBuffer) -> Option<serde_json::Value> {
        let give_up = Instant::now() + Duration::from_secs(3);
        while Instant::now() < give_up {
            if let Some(frame) = frames.next_frame().unwrap() {
                return Some(serde_json::from_slice(&frame).unwrap());
            }
            match conn.available() {
                Err(_) => return None,
                Ok(0) => thread::sleep(Duration::from_millis(5)),
                Ok(_) => {
                    let mut buf = [0u8; 4096];
                    match conn.read(&mut buf) {
                        Ok(n) if n > 0 => frames.push(&buf[..n]),
                        _ => return None,
                    }
                }
            }
        }
        None
    }

    const HELLO: &str = r#"{"t":"hello","seq":1,"pipeVersion":1,"appVersion":"test"}"#;

    #[test]
    fn the_registered_app_gets_a_hello_a_check_result_and_heartbeats() {
        let server = start(me(), good_check());
        let client = Conn::connect(&server.name).unwrap();
        let mut frames = FrameBuffer::default();

        let hello = next(&client, &mut frames).unwrap();
        assert_eq!(hello["t"], "hello");
        assert_eq!(hello["pid"], std::process::id());
        assert_eq!(hello["pipeVersion"], 1);

        put(&client, HELLO);
        put(&client, r#"{"t":"system.check","seq":9}"#);
        let mut beats = Vec::new();
        let mut result = None;
        while beats.len() < 3 || result.is_none() {
            let message = next(&client, &mut frames).unwrap();
            match message["t"].as_str().unwrap() {
                "heartbeat" => {
                    beats.push(message["hbSeq"].as_u64().unwrap());
                    put(
                        &client,
                        &format!(
                            r#"{{"t":"heartbeat.ack","seq":2,"hbSeq":{}}}"#,
                            beats.len() - 1
                        ),
                    );
                }
                "system.check.result" => result = Some(message),
                other => panic!("unexpected {other}"),
            }
        }
        assert_eq!(beats, vec![0, 1, 2]);
        let result = result.unwrap();
        assert_eq!(result["reqSeq"], 9);
        assert_eq!(result["ok"], true);
        assert_eq!(result["monitors"], 2);
        drop(client);
        server.stop();
    }

    #[test]
    fn net_set_is_answered_with_the_status_and_needs_a_hello_first() {
        let server = start(me(), good_check());
        let client = Conn::connect(&server.name).unwrap();
        let mut frames = FrameBuffer::default();
        assert_eq!(next(&client, &mut frames).unwrap()["t"], "hello");

        put(
            &client,
            r#"{"t":"net.set","seq":4,"blocked":true,"allow":["10.0.0.2"]}"#,
        );
        let early = next(&client, &mut frames).unwrap();
        assert_eq!(early["t"], "error");
        assert_eq!(early["code"], "no_hello");

        put(&client, HELLO);
        put(
            &client,
            r#"{"t":"net.set","seq":5,"blocked":true,"allow":["10.0.0.2"]}"#,
        );
        put(
            &client,
            r#"{"t":"net.set","seq":6,"blocked":true,"allow":[]}"#,
        );
        let mut answers = Vec::new();
        while answers.len() < 2 {
            let message = next(&client, &mut frames).unwrap();
            match message["t"].as_str().unwrap() {
                "net.status" => answers.push(message),
                "heartbeat" => {}
                other => panic!("unexpected {other}"),
            }
        }
        assert_eq!(answers[0]["reqSeq"], 5);
        assert_eq!(answers[0]["blocked"], true);
        assert!(answers[0]["error"].is_null());
        assert_eq!(answers[1]["reqSeq"], 6);
        assert_eq!(answers[1]["blocked"], false);
        assert_eq!(answers[1]["error"], "no address");
        drop(client);
        server.stop();
    }

    #[test]
    fn a_failed_check_is_reported_with_its_reasons() {
        let check = CheckResult {
            ok: false,
            helper: true,
            capture_ok: false,
            monitors: 1,
            problems: vec!["The monitoring agent cannot capture the screen.".into()],
        };
        let server = start(me(), check);
        let client = Conn::connect(&server.name).unwrap();
        let mut frames = FrameBuffer::default();
        next(&client, &mut frames).unwrap();
        put(&client, HELLO);
        put(&client, r#"{"t":"system.check","seq":3}"#);
        let result = loop {
            let message = next(&client, &mut frames).unwrap();
            if message["t"] == "system.check.result" {
                break message;
            }
        };
        assert_eq!(result["ok"], false);
        assert_eq!(result["captureOk"], false);
        assert_eq!(
            result["problems"][0],
            "The monitoring agent cannot capture the screen."
        );
        drop(client);
        server.stop();
    }

    #[test]
    fn a_process_that_is_not_the_registered_app_is_cut_off() {
        let other = Some(PathBuf::from(r"C:\Windows\System32\notepad.exe"));
        let server = start(other, good_check());
        let client = Conn::connect(&server.name).unwrap();
        let mut frames = FrameBuffer::default();
        assert!(next(&client, &mut frames).is_none());
        server.stop();
    }

    #[test]
    fn nobody_may_connect_while_no_app_is_registered() {
        let server = start(None, good_check());
        let client = Conn::connect(&server.name).unwrap();
        let mut frames = FrameBuffer::default();
        assert!(next(&client, &mut frames).is_none());
        server.stop();
    }

    #[test]
    fn an_app_that_stops_acknowledging_is_dropped() {
        let server = start(me(), good_check());
        let client = Conn::connect(&server.name).unwrap();
        let mut frames = FrameBuffer::default();
        put(&client, HELLO);
        let mut beats = 0;
        while let Some(message) = next(&client, &mut frames) {
            if message["t"] == "heartbeat" {
                beats += 1;
            }
        }
        assert!(beats >= 2, "got {beats} heartbeats before the drop");
        server.stop();
    }

    #[test]
    fn an_app_that_never_says_hello_is_dropped() {
        let server = start(me(), good_check());
        let client = Conn::connect(&server.name).unwrap();
        let mut frames = FrameBuffer::default();
        assert_eq!(next(&client, &mut frames).unwrap()["t"], "hello");
        assert!(next(&client, &mut frames).is_none());
        server.stop();
    }

    #[test]
    fn another_pipe_version_gets_an_error_and_the_door() {
        let server = start(me(), good_check());
        let client = Conn::connect(&server.name).unwrap();
        let mut frames = FrameBuffer::default();
        next(&client, &mut frames).unwrap();
        put(
            &client,
            r#"{"t":"hello","seq":1,"pipeVersion":2,"appVersion":"x"}"#,
        );
        let message = next(&client, &mut frames).unwrap();
        assert_eq!(message["t"], "error");
        assert_eq!(message["code"], "pipe_version");
        assert!(next(&client, &mut frames).is_none());
        server.stop();
    }

    #[test]
    fn a_message_before_hello_and_a_garbled_one_get_errors() {
        let server = start(me(), good_check());
        let client = Conn::connect(&server.name).unwrap();
        let mut frames = FrameBuffer::default();
        next(&client, &mut frames).unwrap();
        put(&client, r#"{"t":"system.check","seq":1}"#);
        assert_eq!(next(&client, &mut frames).unwrap()["code"], "no_hello");
        put(&client, "not json");
        assert_eq!(next(&client, &mut frames).unwrap()["code"], "bad_message");
        drop(client);
        server.stop();
    }

    #[test]
    fn the_real_access_list_lets_the_server_make_every_instance_and_the_user_connect() {
        // Run by a developer, the server is the interactive user; the service is SYSTEM. Neither
        // may be shut out of its own pipe, and the user must still be able to connect.
        let config = ServerConfig {
            name: unique_name(),
            sddl: crate::pipe_security::SDDL_APP_PIPE.to_string(),
            instances: 3,
            allowed_app: Arc::new(me),
            heartbeat: Duration::from_millis(50),
            lost_after: Duration::from_millis(400),
            hello_within: Duration::from_millis(400),
        };
        let server = PipeServer::start(
            config,
            Arc::new(FakeHealth {
                check: good_check(),
            }),
        )
        .unwrap();
        let client = Conn::connect(&server.name).unwrap();
        let mut frames = FrameBuffer::default();
        assert_eq!(next(&client, &mut frames).unwrap()["t"], "hello");
        drop(client);
        server.stop();
    }

    #[test]
    fn no_other_process_can_take_a_free_instance_of_the_pipe() {
        let server = start(me(), good_check());
        let impostor = Conn::create_instance(&server.name, TEST_SDDL, false, 2);
        assert!(impostor.is_err());
        server.stop();
    }

    #[test]
    fn a_second_server_cannot_take_the_name() {
        let server = start(me(), good_check());
        assert!(Conn::create_instance(&server.name, TEST_SDDL, true, 2).is_err());
        server.stop();
    }

    #[test]
    fn the_same_instance_serves_the_next_connection_after_one_ends() {
        let server = start(me(), good_check());
        for _ in 0..4 {
            // A worker needs a few milliseconds to listen again; a client retries.
            let give_up = Instant::now() + Duration::from_secs(2);
            let client = loop {
                match Conn::connect(&server.name) {
                    Ok(client) => break client,
                    Err(error) => {
                        assert!(Instant::now() < give_up, "could not reconnect: {error}");
                        thread::sleep(Duration::from_millis(10));
                    }
                }
            };
            let mut frames = FrameBuffer::default();
            assert_eq!(next(&client, &mut frames).unwrap()["t"], "hello");
            drop(client);
        }
        server.stop();
    }
}
