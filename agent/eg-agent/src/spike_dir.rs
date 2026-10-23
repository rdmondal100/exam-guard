//! The spike's output folder `%ProgramData%\ExamGuard\spike\`: log files and screenshots.

use std::fs::OpenOptions;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Screenshots kept in the folder; older ones are deleted.
pub const KEEP_SHOTS: usize = 50;

pub fn dir() -> PathBuf {
    let base = std::env::var_os("ProgramData")
        .map_or_else(|| PathBuf::from(r"C:\ProgramData"), PathBuf::from);
    base.join("ExamGuard").join("spike")
}

/// Sends tracing output to `<dir>\<file>` (appended). Falls back to stderr if the file can't be opened.
pub fn init_log(file: &str) {
    let path = dir().join(file);
    let opened = std::fs::create_dir_all(dir())
        .and_then(|()| OpenOptions::new().create(true).append(true).open(&path));
    let builder = tracing_subscriber::fmt().with_ansi(false).with_env_filter(
        tracing_subscriber::EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
    );
    match opened {
        Ok(handle) => builder.with_writer(Mutex::new(handle)).init(),
        Err(error) => {
            builder.with_writer(io::stderr).init();
            tracing::warn!(%error, path = %path.display(), "could not open the log file");
        }
    }
}

/// `shot-<unix ms>.jpg`, zero-padded so names sort by time.
pub fn shot_name(unix_ms: u128) -> String {
    format!("shot-{unix_ms:015}.jpg")
}

fn is_shot(name: &str) -> bool {
    name.starts_with("shot-") && name.ends_with(".jpg")
}

/// Deletes the oldest screenshots so at most `keep` are left. Returns how many were deleted.
pub fn prune(folder: &Path, keep: usize) -> io::Result<usize> {
    let mut shots: Vec<PathBuf> = std::fs::read_dir(folder)?
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_str().is_some_and(is_shot))
        .map(|entry| entry.path())
        .collect();
    if shots.len() <= keep {
        return Ok(0);
    }
    shots.sort();
    let extra = shots.len() - keep;
    for path in &shots[..extra] {
        std::fs::remove_file(path)?;
    }
    Ok(extra)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shot_names_sort_by_time() {
        assert_eq!(shot_name(1_700_000_000_123), "shot-001700000000123.jpg");
        assert!(shot_name(999) < shot_name(1_000));
    }

    #[test]
    fn prune_keeps_the_newest() {
        let folder = std::env::temp_dir().join(format!("eg-agent-prune-{}", std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();
        for ms in 1..=5u128 {
            std::fs::write(folder.join(shot_name(ms)), b"x").unwrap();
        }
        std::fs::write(folder.join("helper.log"), b"log").unwrap();

        assert_eq!(prune(&folder, 3).unwrap(), 2);
        let mut left: Vec<String> = std::fs::read_dir(&folder)
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        left.sort();
        assert_eq!(
            left,
            vec!["helper.log", &shot_name(3), &shot_name(4), &shot_name(5)]
        );
        assert_eq!(prune(&folder, 3).unwrap(), 0);
        std::fs::remove_dir_all(&folder).unwrap();
    }
}
