//! Why a run ended: eg-runner's own exit code and the `--report` JSON file.

/// Exit code for bad command-line arguments.
pub const EXIT_USAGE: i32 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reason {
    /// The program ran to the end (its own exit code is in the report).
    Ok,
    TimeLimit,
    MemoryLimit,
    ProcessLimit,
    /// The program could not be started, or the job could not be set up.
    Failed,
}

impl Reason {
    pub fn as_str(self) -> &'static str {
        match self {
            Reason::Ok => "ok",
            Reason::TimeLimit => "time_limit",
            Reason::MemoryLimit => "memory_limit",
            Reason::ProcessLimit => "process_limit",
            Reason::Failed => "failed",
        }
    }

    /// eg-runner's exit code (architecture §4: the exit code encodes the reason).
    pub fn exit_code(self) -> i32 {
        match self {
            Reason::Ok => 0,
            Reason::TimeLimit => 10,
            Reason::MemoryLimit => 11,
            Reason::ProcessLimit => 12,
            Reason::Failed => 20,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Report {
    pub reason: Reason,
    /// The program's exit code; `None` if it never started.
    pub exit_code: Option<i64>,
    pub time_ms: u64,
    pub peak_mem_mb: u64,
    pub error: Option<String>,
}

impl Report {
    pub fn failed(error: String) -> Self {
        Report {
            reason: Reason::Failed,
            exit_code: None,
            time_ms: 0,
            peak_mem_mb: 0,
            error: Some(error),
        }
    }

    pub fn to_json(&self) -> String {
        let exit = self
            .exit_code
            .map_or_else(|| "null".to_string(), |c| c.to_string());
        let error = self
            .error
            .as_deref()
            .map_or_else(|| "null".to_string(), json_string);
        format!(
            "{{\"reason\":\"{}\",\"exitCode\":{},\"timeMs\":{},\"peakMemMb\":{},\"error\":{}}}",
            self.reason.as_str(),
            exit,
            self.time_ms,
            self.peak_mem_mb,
            error
        )
    }
}

fn json_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_json() {
        let r = Report {
            reason: Reason::TimeLimit,
            exit_code: Some(1),
            time_ms: 5003,
            peak_mem_mb: 3,
            error: None,
        };
        assert_eq!(
            r.to_json(),
            r#"{"reason":"time_limit","exitCode":1,"timeMs":5003,"peakMemMb":3,"error":null}"#
        );
    }

    #[test]
    fn escapes_the_error() {
        let json = Report::failed("no \"a.exe\"\n\\x".into()).to_json();
        assert!(json.contains(r#""error":"no \"a.exe\"\n\\x""#));
        assert!(json.contains(r#""exitCode":null"#));
    }

    #[test]
    fn exit_codes_are_distinct() {
        let all = [
            Reason::Ok,
            Reason::TimeLimit,
            Reason::MemoryLimit,
            Reason::ProcessLimit,
            Reason::Failed,
        ];
        let mut codes: Vec<i32> = all.iter().map(|r| r.exit_code()).collect();
        codes.push(EXIT_USAGE);
        codes.sort();
        codes.dedup();
        assert_eq!(codes.len(), all.len() + 1);
    }
}
