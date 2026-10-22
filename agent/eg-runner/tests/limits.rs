//! Runs the real eg-runner binary against built-in Windows programs.
#![allow(clippy::unwrap_used)] // test helpers outside #[test] fns

use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Output, Stdio};

struct Run {
    out: Output,
    report: String,
}

fn report_path(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join("eg-runner-tests");
    std::fs::create_dir_all(&dir).unwrap();
    dir.join(format!("{name}-{}.json", std::process::id()))
}

fn run(name: &str, flags: &[&str], argv: &[&str], stdin: &str) -> Run {
    let report = report_path(name);
    let mut child = Command::new(env!("CARGO_BIN_EXE_eg-runner"))
        .args(flags)
        .arg("--report")
        .arg(&report)
        .arg("--")
        .args(argv)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(stdin.as_bytes())
        .unwrap();
    let out = child.wait_with_output().unwrap();
    let report = std::fs::read_to_string(&report).unwrap();
    Run { out, report }
}

#[test]
fn passes_through_the_exit_code_and_stdio() {
    let r = run(
        "exit",
        &["--mem", "256", "--time", "5000"],
        &["cmd", "/c", "echo hello& echo oops 1>&2& exit 3"],
        "",
    );
    assert_eq!(r.out.status.code(), Some(0), "{}", r.report);
    assert!(r.report.contains(r#""reason":"ok""#), "{}", r.report);
    assert!(r.report.contains(r#""exitCode":3"#), "{}", r.report);
    assert!(String::from_utf8_lossy(&r.out.stdout).contains("hello"));
    assert!(String::from_utf8_lossy(&r.out.stderr).contains("oops"));
}

#[test]
fn forwards_stdin() {
    // `sort` reads stdin to the end and prints it sorted.
    let r = run(
        "stdin",
        &["--mem", "256", "--time", "5000"],
        &["sort"],
        "b\r\na\r\n",
    );
    assert!(r.report.contains(r#""reason":"ok""#), "{}", r.report);
    assert_eq!(String::from_utf8_lossy(&r.out.stdout), "a\r\nb\r\n");
}

#[test]
fn stops_at_the_time_limit() {
    let started = std::time::Instant::now();
    let r = run(
        "time",
        &["--mem", "256", "--time", "500"],
        &["ping", "-n", "10", "127.0.0.1"],
        "",
    );
    assert_eq!(r.out.status.code(), Some(10), "{}", r.report);
    assert!(r.report.contains(r#""reason":"time_limit""#));
    assert!(started.elapsed().as_millis() < 4000);
}

#[test]
fn reports_the_memory_limit() {
    let r = run(
        "mem",
        &["--mem", "256", "--time", "20000"],
        &[
            "powershell",
            "-NoProfile",
            "-Command",
            "$ErrorActionPreference = 'Stop'; $a = New-Object byte[] (1GB); 'allocated'",
        ],
        "",
    );
    assert_eq!(r.out.status.code(), Some(11), "{}", r.report);
    assert!(r.report.contains(r#""reason":"memory_limit""#));
    assert!(!String::from_utf8_lossy(&r.out.stdout).contains("allocated"));
}

#[test]
fn reports_the_process_limit() {
    let r = run(
        "procs",
        &["--mem", "256", "--time", "5000", "--procs", "1"],
        &["cmd", "/c", "cmd /c exit"],
        "",
    );
    assert_eq!(r.out.status.code(), Some(12), "{}", r.report);
    assert!(r.report.contains(r#""reason":"process_limit""#));
}

#[test]
fn reports_a_program_that_cannot_start() {
    let r = run(
        "missing",
        &["--mem", "256", "--time", "1000"],
        &["no-such-program-eg.exe"],
        "",
    );
    assert_eq!(r.out.status.code(), Some(20), "{}", r.report);
    assert!(r.report.contains(r#""reason":"failed""#));
    assert!(r.report.contains("no-such-program-eg.exe"));
}

#[test]
fn rejects_bad_arguments() {
    let out = Command::new(env!("CARGO_BIN_EXE_eg-runner"))
        .args(["--mem", "1"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(2));
}

#[test]
fn time_zero_means_no_wall_time_limit() {
    // ping -n 3 takes about 2 s; with --time 0 it must finish normally.
    let r = run(
        "notime",
        &["--shell", "--mem", "256", "--time", "0", "--procs", "64"],
        &["ping", "-n", "3", "127.0.0.1"],
        "",
    );
    assert_eq!(r.out.status.code(), Some(0), "{}", r.report);
    assert!(r.report.contains(r#""reason":"ok""#), "{}", r.report);
    assert!(r.report.contains(r#""exitCode":0"#), "{}", r.report);
}
