//! JSON messages on the agent pipes. The app ⇄ agent shapes mirror
//! `packages/shared/src/protocol/agent-pipe.ts` (docs/protocol.md §4); the helper ⇄ service pair
//! is internal to this binary.

use serde::{Deserialize, Serialize};

/// Screenshot and outside-time rules (`MonitorPolicySchema` in the shared package).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MonitorPolicy {
    #[serde(rename = "screenshotOnSwitch")]
    pub screenshot_on_switch: bool,
    #[serde(rename = "titleChangeShots")]
    pub title_change_shots: bool,
    /// A shot this often while the student stays outside; 0 = off.
    #[serde(rename = "periodicOutsideSec")]
    pub periodic_outside_sec: u32,
    #[serde(rename = "minShotGapSec")]
    pub min_shot_gap_sec: u32,
    #[serde(rename = "maxWidth")]
    pub max_width: u32,
    #[serde(rename = "jpegQuality")]
    pub jpeg_quality: u8,
}

/// What the helper saw about a window.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct EvidenceData {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exe: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(
        default,
        rename = "durationMs",
        skip_serializing_if = "Option::is_none"
    )]
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Screenshot {
    #[serde(rename = "jpegBase64")]
    pub jpeg_base64: String,
    pub width: u32,
    pub height: u32,
}

/// One observation, as the helper reports it and the app receives it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EvidenceBody {
    /// Unix ms on this PC.
    pub ts: u64,
    pub kind: String,
    pub data: EvidenceData,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub screenshot: Option<Screenshot>,
}

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
    #[serde(rename = "net.set")]
    NetSet {
        seq: u64,
        blocked: bool,
        allow: Vec<String>,
    },
    #[serde(rename = "monitor.start")]
    MonitorStart {
        seq: u64,
        #[serde(rename = "examStudentId")]
        exam_student_id: String,
        policy: MonitorPolicy,
    },
    #[serde(rename = "monitor.stop")]
    MonitorStop { seq: u64 },
    #[serde(rename = "exam.window")]
    ExamWindow { seq: u64, hwnd: u64, pid: u32 },
    #[serde(rename = "evidence.ack")]
    EvidenceAck {
        seq: u64,
        #[serde(rename = "upTo")]
        up_to: u64,
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
    #[serde(rename = "net.status")]
    NetStatus {
        seq: u64,
        #[serde(rename = "reqSeq")]
        req_seq: u64,
        blocked: bool,
        error: Option<String>,
    },
    #[serde(rename = "evidence")]
    Evidence {
        seq: u64,
        #[serde(rename = "evidenceSeq")]
        evidence_seq: u64,
        #[serde(flatten)]
        body: EvidenceBody,
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
    #[serde(rename = "monitor.start")]
    MonitorStart { policy: MonitorPolicy },
    #[serde(rename = "monitor.stop")]
    MonitorStop,
    #[serde(rename = "exam.window")]
    ExamWindow { hwnd: u64, pid: u32 },
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
    #[serde(rename = "evidence")]
    Evidence {
        #[serde(flatten)]
        body: EvidenceBody,
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
    fn net_set_parses_and_net_status_serializes_like_the_shared_schema() {
        let set: FromApp = serde_json::from_str(
            r#"{"t":"net.set","seq":3,"blocked":true,"allow":["192.168.1.10"]}"#,
        )
        .unwrap();
        assert_eq!(
            set,
            FromApp::NetSet {
                seq: 3,
                blocked: true,
                allow: vec!["192.168.1.10".into()]
            }
        );
        assert!(
            serde_json::from_str::<FromApp>(r#"{"t":"net.set","seq":3,"blocked":true}"#).is_err()
        );
        let status = serde_json::to_value(ToApp::NetStatus {
            seq: 4,
            req_seq: 3,
            blocked: false,
            error: Some("denied".into()),
        })
        .unwrap();
        assert_eq!(
            status,
            serde_json::json!({"t":"net.status","seq":4,"reqSeq":3,"blocked":false,"error":"denied"})
        );
        let clean = serde_json::to_value(ToApp::NetStatus {
            seq: 5,
            req_seq: 3,
            blocked: true,
            error: None,
        })
        .unwrap();
        assert!(clean["error"].is_null());
    }

    const POLICY: &str = r#"{"screenshotOnSwitch":true,"titleChangeShots":false,"periodicOutsideSec":20,"minShotGapSec":5,"maxWidth":1600,"jpegQuality":60}"#;

    #[test]
    fn monitoring_messages_parse_like_the_shared_schema() {
        let start: FromApp = serde_json::from_str(&format!(
            r#"{{"t":"monitor.start","seq":1,"examStudentId":"s","policy":{POLICY}}}"#
        ))
        .unwrap();
        let FromApp::MonitorStart { policy, .. } = start else {
            panic!("not a monitor.start");
        };
        assert!(policy.screenshot_on_switch && !policy.title_change_shots);
        assert_eq!(policy.periodic_outside_sec, 20);
        assert_eq!(policy.jpeg_quality, 60);

        let window: FromApp =
            serde_json::from_str(r#"{"t":"exam.window","seq":2,"hwnd":66012,"pid":4100}"#).unwrap();
        assert_eq!(
            window,
            FromApp::ExamWindow {
                seq: 2,
                hwnd: 66012,
                pid: 4100
            }
        );
        let ack: FromApp =
            serde_json::from_str(r#"{"t":"evidence.ack","seq":3,"upTo":12}"#).unwrap();
        assert_eq!(ack, FromApp::EvidenceAck { seq: 3, up_to: 12 });
        assert!(
            serde_json::from_str::<FromApp>(r#"{"t":"exam.window","seq":2,"hwnd":1}"#).is_err()
        );
    }

    fn body() -> EvidenceBody {
        EvidenceBody {
            ts: 1_700_000_000_000,
            kind: "focus_lost".into(),
            data: EvidenceData {
                exe: Some("chrome.exe".into()),
                pid: Some(77),
                ..EvidenceData::default()
            },
            screenshot: Some(Screenshot {
                jpeg_base64: "/9j/".into(),
                width: 800,
                height: 450,
            }),
        }
    }

    #[test]
    fn evidence_reaches_the_app_flat_with_its_sequence_number() {
        let wire = serde_json::to_value(ToApp::Evidence {
            seq: 5,
            evidence_seq: 9,
            body: body(),
        })
        .unwrap();
        assert_eq!(
            wire,
            serde_json::json!({
                "t":"evidence","seq":5,"evidenceSeq":9,"ts":1_700_000_000_000u64,"kind":"focus_lost",
                "data":{"exe":"chrome.exe","pid":77},
                "screenshot":{"jpegBase64":"/9j/","width":800,"height":450}
            })
        );
    }

    #[test]
    fn evidence_and_commands_survive_the_helper_pipe() {
        let evidence = FromHelper::Evidence { body: body() };
        let json = serde_json::to_string(&evidence).unwrap();
        assert_eq!(serde_json::from_str::<FromHelper>(&json).unwrap(), evidence);
        let start: ToHelper =
            serde_json::from_str(&format!(r#"{{"t":"monitor.start","policy":{POLICY}}}"#)).unwrap();
        assert!(matches!(start, ToHelper::MonitorStart { .. }));
        let stop = serde_json::to_string(&ToHelper::MonitorStop).unwrap();
        assert_eq!(stop, r#"{"t":"monitor.stop"}"#);
        let window = serde_json::to_string(&ToHelper::ExamWindow { hwnd: 5, pid: 6 }).unwrap();
        assert_eq!(window, r#"{"t":"exam.window","hwnd":5,"pid":6}"#);
    }

    #[test]
    fn an_unknown_type_or_a_missing_field_does_not_parse() {
        assert!(serde_json::from_str::<FromApp>(r#"{"t":"monitor.start","seq":1}"#).is_err());
        assert!(serde_json::from_str::<FromApp>(r#"{"t":"monitor.pause","seq":1}"#).is_err());
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
