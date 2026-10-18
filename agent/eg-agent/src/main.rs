//! eg-agent: Windows service + session helper that observes and reports.
//! Empty skeleton (M01). Design: docs/architecture.md §3.

fn main() {
    tracing_subscriber::fmt().init();
    tracing::info!(version = env!("CARGO_PKG_VERSION"), "eg-agent skeleton");
}

#[cfg(test)]
mod tests {
    #[test]
    fn version_is_set() {
        assert!(!env!("CARGO_PKG_VERSION").is_empty());
    }
}
