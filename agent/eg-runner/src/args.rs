//! Command line: `eg-runner --mem <MB> --time <ms> [--procs N] [--report <file>] [--shell] -- <argv…>`.
//! `--time 0` means no wall-time limit (the exam terminal).

use std::path::PathBuf;

/// Default number of processes the job may hold at once (architecture §4).
pub const DEFAULT_PROCS: u32 = 8;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Args {
    pub mem_mb: u64,
    pub time_ms: u64,
    pub procs: u32,
    pub report: Option<PathBuf>,
    /// Survive Ctrl+C / Ctrl+Break, so the key reaches the shell in a terminal instead of
    /// ending eg-runner (and with it the job).
    pub shell: bool,
    /// The program and its arguments, as given after `--`.
    pub command: Vec<String>,
}

fn number<T: std::str::FromStr>(flag: &str, value: Option<String>) -> Result<T, String> {
    let value = value.ok_or_else(|| format!("{flag} needs a value"))?;
    value
        .parse::<T>()
        .map_err(|_| format!("{flag}: '{value}' is not a valid number"))
}

/// Parses the arguments after the program name.
pub fn parse<I: IntoIterator<Item = String>>(args: I) -> Result<Args, String> {
    let mut it = args.into_iter();
    let mut mem_mb = None;
    let mut time_ms = None;
    let mut procs = DEFAULT_PROCS;
    let mut report = None;
    let mut shell = false;
    let mut command = Vec::new();
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--mem" => mem_mb = Some(number::<u64>("--mem", it.next())?),
            "--time" => time_ms = Some(number::<u64>("--time", it.next())?),
            "--procs" => procs = number::<u32>("--procs", it.next())?,
            "--report" => report = Some(PathBuf::from(it.next().ok_or("--report needs a value")?)),
            "--shell" => shell = true,
            "--" => {
                command = it.by_ref().collect();
                break;
            }
            other => return Err(format!("unknown argument '{other}'")),
        }
    }
    let mem_mb = mem_mb.ok_or("--mem is required")?;
    let time_ms = time_ms.ok_or("--time is required")?;
    if mem_mb == 0 || procs == 0 {
        return Err("--mem and --procs must be above 0".into());
    }
    if command.is_empty() {
        return Err("give the program to run after --".into());
    }
    Ok(Args {
        mem_mb,
        time_ms,
        procs,
        report,
        shell,
        command,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(s: &[&str]) -> Result<Args, String> {
        parse(s.iter().map(|x| x.to_string()))
    }

    #[test]
    fn parses_all_flags() {
        let a = p(&[
            "--mem", "256", "--time", "5000", "--procs", "4", "--report", "r.json", "--", "a.exe",
            "-x",
        ])
        .unwrap();
        assert_eq!(a.mem_mb, 256);
        assert_eq!(a.time_ms, 5000);
        assert_eq!(a.procs, 4);
        assert_eq!(a.report, Some(PathBuf::from("r.json")));
        assert_eq!(a.command, vec!["a.exe", "-x"]);
    }

    #[test]
    fn procs_defaults_to_eight_and_flags_after_dashes_belong_to_the_program() {
        let a = p(&["--time", "1", "--mem", "1", "--", "x", "--mem", "9"]).unwrap();
        assert_eq!(a.procs, DEFAULT_PROCS);
        assert_eq!(a.report, None);
        assert!(!a.shell);
        assert_eq!(a.command, vec!["x", "--mem", "9"]);
    }

    #[test]
    fn shell_mode_allows_no_time_limit() {
        let a = p(&[
            "--shell", "--mem", "2048", "--time", "0", "--procs", "64", "--", "pwsh",
        ])
        .unwrap();
        assert!(a.shell);
        assert_eq!(a.time_ms, 0);
        assert_eq!(a.procs, 64);
    }

    #[test]
    fn rejects_bad_input() {
        assert!(p(&["--time", "1", "--", "x"]).is_err());
        assert!(p(&["--mem", "1", "--time", "1"]).is_err());
        assert!(p(&["--mem", "abc", "--time", "1", "--", "x"]).is_err());
        assert!(p(&["--mem", "0", "--time", "1", "--", "x"]).is_err());
        assert!(p(&["--mem", "1", "--time", "1", "--procs", "0", "--", "x"]).is_err());
        assert!(p(&["--mem", "1", "--time", "1", "--what", "--", "x"]).is_err());
        assert!(p(&["--mem"]).is_err());
    }
}
