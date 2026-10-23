//! The agent's system check: is the helper there, can it capture the screen, how many monitors.
//! The helper reports what it saw; this module decides what that means and how to say it.

/// What the helper found with a test capture.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HelperReport {
    pub capture_ok: bool,
    pub monitors: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CheckResult {
    pub ok: bool,
    pub helper: bool,
    pub capture_ok: bool,
    pub monitors: u32,
    pub problems: Vec<String>,
}

/// `report` is `None` when no helper is connected or it did not answer in time.
pub fn evaluate(report: Option<HelperReport>) -> CheckResult {
    let Some(report) = report else {
        return CheckResult {
            ok: false,
            helper: false,
            capture_ok: false,
            monitors: 0,
            problems: vec!["The monitoring helper is not running.".to_string()],
        };
    };
    let mut problems = Vec::new();
    if !report.capture_ok {
        problems.push("The monitoring agent cannot capture the screen.".to_string());
    }
    if report.monitors == 0 {
        problems.push("The monitoring agent sees no screen.".to_string());
    }
    CheckResult {
        ok: problems.is_empty(),
        helper: true,
        capture_ok: report.capture_ok,
        monitors: report.monitors,
        problems,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_helper_with_a_good_capture_passes() {
        let result = evaluate(Some(HelperReport {
            capture_ok: true,
            monitors: 2,
        }));
        assert!(result.ok);
        assert!(result.problems.is_empty());
        assert_eq!(result.monitors, 2);
    }

    #[test]
    fn no_helper_is_a_failure_with_one_reason() {
        let result = evaluate(None);
        assert!(!result.ok && !result.helper && !result.capture_ok);
        assert_eq!(result.problems.len(), 1);
    }

    #[test]
    fn a_black_capture_and_no_monitor_are_both_named() {
        let result = evaluate(Some(HelperReport {
            capture_ok: false,
            monitors: 0,
        }));
        assert!(!result.ok && result.helper);
        assert_eq!(result.problems.len(), 2);
    }
}
