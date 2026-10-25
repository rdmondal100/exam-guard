//! What the app's `net.set` does. One `NetControl` lives in the agent next to the pipes; the pipe
//! workers call `set` and a timer calls `tick`, so the lease runs out even when no app is talking.
//!
//! The app repeats `blocked: true` with every heartbeat. A repeat of the same request only renews
//! the lease; a different address list replaces the filters. Each change is logged as
//! `internet_blocked`, `internet_allowed` or `internet_block_failed`.

use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use crate::net_block::{FilterBackend, NetBlock, Tick};
use crate::net_rules::parse_addresses;

/// The answer to a `net.set`: whether the block is in place now, and why a change did not happen.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NetStatus {
    pub blocked: bool,
    pub error: Option<String>,
}

pub struct NetControl<B: FilterBackend> {
    block: Mutex<NetBlock<B>>,
    lease: Duration,
}

impl<B: FilterBackend> NetControl<B> {
    pub fn new(backend: B, lease: Duration) -> Self {
        Self {
            block: Mutex::new(NetBlock::new(backend)),
            lease,
        }
    }

    fn lock(&self) -> MutexGuard<'_, NetBlock<B>> {
        // A panic while holding the lock leaves the block in a state we can still release.
        self.block.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn set(&self, blocked: bool, allow: &[String], now: Instant) -> NetStatus {
        let mut block = self.lock();
        let was_blocked = block.is_active();
        let result = if blocked {
            self.block_on(&mut block, allow, now)
        } else {
            block.release()
        };
        let status = NetStatus {
            blocked: block.is_active(),
            error: result.as_ref().err().cloned(),
        };
        match (&result, was_blocked, status.blocked) {
            (Err(error), _, _) if blocked => {
                tracing::error!(%error, "internet_block_failed");
            }
            (Err(error), _, _) => tracing::error!(%error, "internet filters not removed"),
            (Ok(()), false, true) => tracing::info!(allow = ?allow, "internet_blocked"),
            (Ok(()), true, false) => tracing::info!("internet_allowed"),
            _ => {}
        }
        status
    }

    fn block_on(
        &self,
        block: &mut NetBlock<B>,
        allow: &[String],
        now: Instant,
    ) -> Result<(), String> {
        let mut wanted = parse_addresses(&allow.join(","))?;
        wanted.sort();
        let same = block.allowed().is_some_and(|current| {
            let mut current = current.to_vec();
            current.sort();
            current == wanted
        });
        if same {
            block.renew(now);
            Ok(())
        } else {
            block.apply(&wanted, self.lease, now)
        }
    }

    /// Removes the block when its lease has run out. Called a few times a second.
    pub fn tick(&self, now: Instant) {
        if let Tick::Released(result) = self.lock().tick(now) {
            match result {
                Ok(()) => tracing::info!("internet_allowed (lease)"),
                Err(error) => tracing::error!(%error, "internet filters not removed, retrying"),
            }
        }
    }

    /// The agent is stopping: the PC must not stay blocked.
    pub fn release(&self) {
        if let Err(error) = self.lock().release() {
            tracing::error!(%error, "internet filters not removed on stop");
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::net_rules::Rule;

    #[derive(Default)]
    struct State {
        installs: usize,
        installed: bool,
        fail_install: bool,
    }

    struct Fake(Arc<Mutex<State>>);

    impl FilterBackend for Fake {
        fn install(&mut self, _rules: &[Rule]) -> Result<(), String> {
            let mut s = self.0.lock().expect("lock");
            s.installed = false;
            if s.fail_install {
                return Err("access denied (0x00000005)".to_string());
            }
            s.installs += 1;
            s.installed = true;
            Ok(())
        }

        fn remove(&mut self) -> Result<(), String> {
            self.0.lock().expect("lock").installed = false;
            Ok(())
        }
    }

    const LEASE: Duration = Duration::from_secs(180);

    fn control() -> (NetControl<Fake>, Arc<Mutex<State>>, Instant) {
        let state = Arc::new(Mutex::new(State::default()));
        (
            NetControl::new(Fake(state.clone()), LEASE),
            state,
            Instant::now(),
        )
    }

    fn teacher() -> Vec<String> {
        vec!["192.168.1.10".to_string()]
    }

    #[test]
    fn a_block_request_installs_and_reports_blocked() {
        let (net, state, now) = control();
        assert_eq!(
            net.set(true, &teacher(), now),
            NetStatus {
                blocked: true,
                error: None
            }
        );
        assert!(state.lock().expect("lock").installed);
    }

    #[test]
    fn repeating_the_same_request_only_renews_the_lease() {
        let (net, state, now) = control();
        net.set(true, &teacher(), now);
        let later = now + Duration::from_secs(170);
        net.set(true, &teacher(), later);
        assert_eq!(state.lock().expect("lock").installs, 1);
        // 170 s + 170 s is past the first deadline but not the renewed one.
        net.tick(later + Duration::from_secs(170));
        assert!(state.lock().expect("lock").installed);
        net.tick(later + LEASE);
        assert!(!state.lock().expect("lock").installed);
    }

    #[test]
    fn a_different_address_list_replaces_the_filters_whatever_the_order() {
        let (net, state, now) = control();
        let two = vec!["10.0.0.2".to_string(), "192.168.1.10".to_string()];
        let swapped = vec!["192.168.1.10".to_string(), "10.0.0.2".to_string()];
        net.set(true, &two, now);
        net.set(true, &swapped, now);
        assert_eq!(state.lock().expect("lock").installs, 1);
        net.set(true, &teacher(), now);
        assert_eq!(state.lock().expect("lock").installs, 2);
    }

    #[test]
    fn an_unblock_request_removes_the_filters() {
        let (net, state, now) = control();
        net.set(true, &teacher(), now);
        let status = net.set(false, &[], now);
        assert_eq!(
            status,
            NetStatus {
                blocked: false,
                error: None
            }
        );
        assert!(!state.lock().expect("lock").installed);
        assert!(!net.set(false, &[], now).blocked);
    }

    #[test]
    fn bad_addresses_are_refused_and_nothing_is_blocked() {
        let (net, state, now) = control();
        for bad in [
            vec![],
            vec!["example.com".to_string()],
            vec!["0.0.0.0".to_string()],
        ] {
            let status = net.set(true, &bad, now);
            assert!(!status.blocked);
            assert!(status.error.is_some());
        }
        assert_eq!(state.lock().expect("lock").installs, 0);
    }

    #[test]
    fn a_failed_install_reports_why_and_leaves_the_pc_unblocked() {
        let (net, state, now) = control();
        state.lock().expect("lock").fail_install = true;
        let status = net.set(true, &teacher(), now);
        assert!(!status.blocked);
        assert_eq!(status.error.as_deref(), Some("access denied (0x00000005)"));
    }

    #[test]
    fn the_lease_ends_a_block_nobody_renews() {
        let (net, state, now) = control();
        net.set(true, &teacher(), now);
        net.tick(now + LEASE);
        assert!(!state.lock().expect("lock").installed);
        assert!(!net.set(false, &[], now + LEASE).blocked);
    }

    #[test]
    fn release_on_stop_removes_the_filters() {
        let (net, state, now) = control();
        net.set(true, &teacher(), now);
        net.release();
        assert!(!state.lock().expect("lock").installed);
    }
}
