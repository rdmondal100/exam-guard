//! Starts the student app again when it is gone while monitoring is on (architecture §3): no
//! verified app on the pipe for `GONE_FOR` → launch it in the student's session with the student's
//! own token, and report `app_relaunched`. The program is always the one the pipe verified; the app
//! only says, in its `hello`, which arguments, folder and dev variables to start it with.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::Deserialize;

/// How long monitoring may run with no app before it is started again.
pub const GONE_FOR: Duration = Duration::from_secs(3);
/// A launch whose app never connects is retried after this, doubling up to `MAX_RETRY`.
const FIRST_RETRY: Duration = Duration::from_secs(10);
const MAX_RETRY: Duration = Duration::from_secs(60);

const MAX_ARGS: usize = 32;
const MAX_ARG_LEN: usize = 2048;
const MAX_ENV: usize = 32;
const MAX_ENV_LEN: usize = 4096;

/// What the app sends in its `hello` (`launch`, shared `PipeLaunchSchema`).
#[derive(Debug, Clone, Default, Deserialize, PartialEq, Eq)]
pub struct LaunchRequest {
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}

/// How to start the app again.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchSpec {
    pub exe: PathBuf,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
    /// Added to the student's own environment.
    pub env: Vec<(String, String)>,
}

/// Only ExamGuard's own variables and Electron's dev ones pass, never one that would make Electron
/// run as plain Node.
fn env_allowed(name: &str) -> bool {
    (name.starts_with("EG_") || name.starts_with("ELECTRON_"))
        && name != "ELECTRON_RUN_AS_NODE"
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

impl LaunchSpec {
    /// `exe` is the program the pipe verified; the rest comes from the app, trimmed to the limits.
    pub fn from_request(exe: &Path, request: &LaunchRequest) -> Self {
        let args = request
            .args
            .iter()
            .filter(|arg| arg.len() <= MAX_ARG_LEN && !arg.contains('\0'))
            .take(MAX_ARGS)
            .cloned()
            .collect();
        let env = request
            .env
            .iter()
            .filter(|(name, value)| {
                env_allowed(name) && value.len() <= MAX_ENV_LEN && !value.contains('\0')
            })
            .take(MAX_ENV)
            .map(|(name, value)| (name.clone(), value.clone()))
            .collect();
        let cwd = request
            .cwd
            .as_deref()
            .filter(|cwd| !cwd.is_empty() && cwd.len() <= 520 && !cwd.contains('\0'))
            .map(PathBuf::from);
        Self {
            exe: exe.to_path_buf(),
            args,
            cwd,
            env,
        }
    }

    /// The whole command line, quoted the way the C runtime splits it again.
    pub fn command_line(&self) -> String {
        std::iter::once(self.exe.to_string_lossy().into_owned())
            .chain(self.args.iter().cloned())
            .map(|arg| quote(&arg))
            .collect::<Vec<_>>()
            .join(" ")
    }
}

/// One argument for a Windows command line (backslashes double only before a quote).
pub fn quote(arg: &str) -> String {
    if !arg.is_empty() && !arg.contains([' ', '\t', '\n', '"']) {
        return arg.to_string();
    }
    let mut out = String::from("\"");
    let mut backslashes = 0usize;
    for c in arg.chars() {
        match c {
            '\\' => backslashes += 1,
            '"' => {
                out.push_str(&"\\".repeat(backslashes * 2 + 1));
                out.push('"');
                backslashes = 0;
            }
            _ => {
                out.push_str(&"\\".repeat(backslashes));
                out.push(c);
                backslashes = 0;
            }
        }
    }
    out.push_str(&"\\".repeat(backslashes * 2));
    out.push('"');
    out
}

/// When to launch. Pure: it gets the time and what the agent knows, and says "launch now".
#[derive(Default)]
pub struct Relauncher {
    gone_since: Option<Instant>,
    not_before: Option<Instant>,
    retry: Duration,
}

impl Relauncher {
    /// Called a few times a second. `true` means: start the app now.
    pub fn tick(&mut self, now: Instant, monitoring: bool, app_connected: bool) -> bool {
        if !monitoring || app_connected {
            *self = Self::default();
            return false;
        }
        let since = *self.gone_since.get_or_insert(now);
        if now.duration_since(since) < GONE_FOR || self.not_before.is_some_and(|t| now < t) {
            return false;
        }
        self.retry = if self.retry.is_zero() {
            FIRST_RETRY
        } else {
            (self.retry * 2).min(MAX_RETRY)
        };
        self.not_before = Some(now + self.retry);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_app_is_started_after_three_seconds_gone_and_retried_with_growing_gaps() {
        let mut r = Relauncher::default();
        let t0 = Instant::now();
        assert!(!r.tick(t0, true, false));
        assert!(!r.tick(t0 + Duration::from_millis(2900), true, false));
        assert!(r.tick(t0 + GONE_FOR, true, false));
        assert!(!r.tick(t0 + GONE_FOR + Duration::from_secs(9), true, false));
        assert!(r.tick(t0 + GONE_FOR + FIRST_RETRY, true, false));
        assert!(!r.tick(
            t0 + GONE_FOR + FIRST_RETRY + Duration::from_secs(19),
            true,
            false
        ));
        assert!(r.tick(t0 + GONE_FOR + FIRST_RETRY * 3, true, false));
    }

    #[test]
    fn nothing_is_started_without_monitoring_or_while_the_app_is_there() {
        let mut r = Relauncher::default();
        let t0 = Instant::now();
        for s in 0..10 {
            assert!(!r.tick(t0 + Duration::from_secs(s), false, false));
            assert!(!r.tick(t0 + Duration::from_secs(s), true, true));
        }
        // A connection in between starts the count over.
        assert!(!r.tick(t0, true, false));
        assert!(!r.tick(t0 + Duration::from_secs(2), true, true));
        assert!(!r.tick(t0 + Duration::from_secs(4), true, false));
        assert!(r.tick(t0 + Duration::from_secs(7), true, false));
    }

    #[test]
    fn arguments_are_quoted_like_the_c_runtime_reads_them() {
        assert_eq!(quote("plain"), "plain");
        assert_eq!(quote(""), "\"\"");
        assert_eq!(quote(r"C:\Program Files\x"), r#""C:\Program Files\x""#);
        assert_eq!(quote(r#"say "hi""#), r#""say \"hi\"""#);
        assert_eq!(quote(r"ends in\ "), r#""ends in\ ""#);
        assert_eq!(quote(r"dir with space\"), r#""dir with space\\""#);
    }

    #[test]
    fn a_request_keeps_the_verified_program_and_only_allowed_variables() {
        let request = LaunchRequest {
            args: vec![
                ".".into(),
                "--profile".into(),
                "student".into(),
                "x\0y".into(),
            ],
            cwd: Some(r"E:\dev\app".into()),
            env: BTreeMap::from([
                ("EG_FAKE_AGENT".to_string(), "0".to_string()),
                (
                    "ELECTRON_RENDERER_URL".to_string(),
                    "http://localhost:5173".to_string(),
                ),
                ("ELECTRON_RUN_AS_NODE".to_string(), "1".to_string()),
                ("PATH".to_string(), r"C:\evil".to_string()),
                ("EG_BAD=NAME".to_string(), "1".to_string()),
            ]),
        };
        let spec = LaunchSpec::from_request(
            Path::new(r"C:\Program Files\ExamGuard\ExamGuard.exe"),
            &request,
        );
        assert_eq!(spec.args, vec![".", "--profile", "student"]);
        assert_eq!(spec.cwd, Some(PathBuf::from(r"E:\dev\app")));
        let names: Vec<&str> = spec.env.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(names, vec!["EG_FAKE_AGENT", "ELECTRON_RENDERER_URL"]);
        assert_eq!(
            spec.command_line(),
            r#""C:\Program Files\ExamGuard\ExamGuard.exe" . --profile student"#
        );
    }
}
