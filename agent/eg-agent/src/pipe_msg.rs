//! JSON messages on the agent pipes. The app ⇄ agent shapes mirror
//! `packages/shared/src/protocol/agent-pipe.ts` (docs/protocol.md §4); the helper ⇄ service pair
//! is internal to this binary.

use serde::{Deserialize, Serialize};

/// App → agent. Anything else on the wire fails to parse and is answered with an `error`.
#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(tag = "t")]
pub enum FromApp {
    #[serde(rename = "hello")]
    Hello {
        seq: u64,
        #[serde(rename = "pipeVersion")]
        pipe_version: u32,
        #[serde(rename = "appVersion")]
        app_version: String,
    },
    #[serde(rename = "system.check")]
    SystemCheck { seq: u64 },
    #[serde(rename = "heartbeat.ack")]
    HeartbeatAck {
        seq: u64,
        #[serde(rename = "hbSeq")]
        hb_seq: u64,
    },
}

/// Agent → app.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "t")]
pub enum ToApp {
    #[serde(rename = "hello")]
    Hello {
        seq: u64,
        #[serde(rename = "pipeVersion")]
        pipe_version: u32,
        #[serde(rename = "agentVersion")]
        agent_version: String,
        pid: u32,
        helper: bool,
    },
    #[serde(rename = "system.check.result")]
    SystemCheckResult {
        seq: u64,
        #[serde(rename = "reqSeq")]
        req_seq: u64,
        ok: bool,
        helper: bool,
        #[serde(rename = "captureOk")]
        capture_ok: bool,
        monitors: u32,
        problems: Vec<String>,
    },
    #[serde(rename = "heartbeat")]
    Heartbeat {
        seq: u64,
        #[serde(rename = "hbSeq")]
        hb_seq: u64,
        helper: bool,
        monitoring: bool,
    },
    #[serde(rename = "error")]
    Error {
        seq: u64,
        code: String,
        message: String,
    },
}

/// Service → helper, on the helper pipe.
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "t")]
pub enum ToHelper {
    #[serde(rename = "check")]
    Check { seq: u64 },
}

/// Helper → service.
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "t")]
pub enum FromHelper {
    #[serde(rename = "check.result")]
    CheckResult {
        seq: u64,
        #[serde(rename = "captureOk")]
        capture_ok: bool,
        monitors: u32,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_messages_parse_with_the_camel_case_names_of_the_shared_schema() {
        let hello: FromApp =
            serde_json::from_str(r#"{"t":"hello","seq":1,"pipeVersion":1,"appVersion":"0.0.0"}"#)
                .unwrap();
        assert_eq!(
            hello,
            FromApp::Hello {
                seq: 1,
                pipe_version: 1,
                app_version: "0.0.0".into()
            }
        );
        let ack: FromApp =
            serde_json::from_str(r#"{"t":"heartbeat.ack","seq":4,"hbSeq":9}"#).unwrap();
        assert_eq!(ack, FromApp::HeartbeatAck { seq: 4, hb_seq: 9 });
    }

    #[test]
    fn an_unknown_type_or_a_missing_field_does_not_parse() {
        assert!(serde_json::from_str::<FromApp>(r#"{"t":"monitor.start","seq":1}"#).is_err());
        assert!(serde_json::from_str::<FromApp>(r#"{"t":"system.check"}"#).is_err());
        assert!(serde_json::from_str::<FromApp>("not json").is_err());
    }

    #[test]
    fn agent_messages_serialize_with_the_names_the_app_expects() {
        let hello = serde_json::to_value(ToApp::Hello {
            seq: 1,
            pipe_version: 1,
            agent_version: "1.2.3".into(),
            pid: 77,
            helper: true,
        })
        .unwrap();
        assert_eq!(
            hello,
            serde_json::json!({"t":"hello","seq":1,"pipeVersion":1,"agentVersion":"1.2.3","pid":77,"helper":true})
        );
        let result = serde_json::to_value(ToApp::SystemCheckResult {
            seq: 2,
            req_seq: 5,
            ok: false,
            helper: true,
            capture_ok: false,
            monitors: 0,
            problems: vec!["x".into()],
        })
        .unwrap();
        assert_eq!(result["t"], "system.check.result");
        assert_eq!(result["reqSeq"], 5);
        assert_eq!(result["captureOk"], false);
    }
}
