//! `tracing` output for the service and the helper: a file in the data folder, or stderr.

use std::fs::OpenOptions;
use std::io;
use std::path::Path;
use std::sync::Mutex;

use crate::config::{data_dir, MAX_LOG_BYTES};

/// `RUST_LOG` if set, else `info`.
fn filter() -> tracing_subscriber::EnvFilter {
    tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"))
}

fn init_with<W>(writer: W)
where
    W: for<'a> tracing_subscriber::fmt::MakeWriter<'a> + Send + Sync + 'static,
{
    tracing_subscriber::fmt()
        .with_ansi(false)
        .with_env_filter(filter())
        .with_writer(writer)
        .init();
}

/// Moves `path` to `<path>.old` when it is bigger than `max` bytes (the old copy is replaced).
fn rotate(path: &Path, max: u64) -> io::Result<bool> {
    match std::fs::metadata(path) {
        Ok(meta) if meta.len() > max => {
            let mut old = path.as_os_str().to_owned();
            old.push(".old");
            std::fs::rename(path, old)?;
            Ok(true)
        }
        Ok(_) => Ok(false),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

/// Sends tracing output to `<data dir>\<file>` (appended). Falls back to stderr if the file can't
/// be opened.
pub fn init_file(file: &str) {
    let path = data_dir().join(file);
    let opened = std::fs::create_dir_all(data_dir()).and_then(|()| {
        // A failed rotation only means a bigger file.
        let _ = rotate(&path, MAX_LOG_BYTES);
        OpenOptions::new().create(true).append(true).open(&path)
    });
    match opened {
        Ok(handle) => init_with(Mutex::new(handle)),
        Err(error) => {
            init_with(io::stderr);
            tracing::warn!(%error, path = %path.display(), "could not open the log file");
        }
    }
}

/// Tracing output to the console (`--console`).
pub fn init_stderr() {
    init_with(io::stderr);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn big_logs_move_aside_and_small_ones_stay() {
        let folder = std::env::temp_dir().join(format!("eg-agent-log-{}", std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();
        let log = folder.join("service.log");

        assert!(!rotate(&log, 10).unwrap(), "a missing file is not an error");
        std::fs::write(&log, b"0123456789").unwrap();
        assert!(!rotate(&log, 10).unwrap(), "exactly the limit stays");
        std::fs::write(&log, b"0123456789a").unwrap();
        assert!(rotate(&log, 10).unwrap());
        assert!(!log.exists());
        assert_eq!(
            std::fs::read(folder.join("service.log.old")).unwrap(),
            b"0123456789a"
        );
        std::fs::remove_dir_all(&folder).unwrap();
    }
}
