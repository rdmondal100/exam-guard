//! eg-runner: Job Object launcher for student code runs.
//! Empty skeleton (M01). Design: docs/architecture.md §4.

fn main() {
    tracing_subscriber::fmt().init();
    tracing::info!(version = env!("CARGO_PKG_VERSION"), "eg-runner skeleton");
}

#[cfg(test)]
mod tests {
    #[test]
    fn version_is_set() {
        assert!(!env!("CARGO_PKG_VERSION").is_empty());
    }
}
