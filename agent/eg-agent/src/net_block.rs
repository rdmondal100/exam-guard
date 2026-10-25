//! The internet-off state: which filters are installed and until when. The lease is what keeps a PC
//! from staying offline when the app goes quiet; the caller renews it and calls `tick`.
//!
//! The WFP calls are behind `FilterBackend`, so this logic is tested with a fake.

use std::net::Ipv4Addr;
use std::time::{Duration, Instant};

use crate::net_rules::{build_rules, Rule};

pub trait FilterBackend {
    /// Replaces whatever was installed with `rules`. On an error nothing is left installed.
    fn install(&mut self, rules: &[Rule]) -> Result<(), String>;
    /// Removes everything. Removing nothing is fine.
    fn remove(&mut self) -> Result<(), String>;
}

struct Active {
    allow: Vec<Ipv4Addr>,
    lease: Duration,
    lease_until: Instant,
    /// A removal failed; `tick` tries again whatever the lease says.
    stuck: bool,
}

pub enum Tick {
    Idle,
    /// The lease ran out (or an earlier removal was retried) and this is how removing went.
    Released(Result<(), String>),
}

pub struct NetBlock<B: FilterBackend> {
    backend: B,
    active: Option<Active>,
}

impl<B: FilterBackend> NetBlock<B> {
    pub fn new(backend: B) -> Self {
        Self {
            backend,
            active: None,
        }
    }

    pub fn is_active(&self) -> bool {
        self.active.is_some()
    }

    /// Blocks outbound connects except to `allow`, for `lease` from `now`. A second call replaces the
    /// first. Bad input changes nothing; a failed install leaves the PC unblocked.
    pub fn apply(
        &mut self,
        allow: &[Ipv4Addr],
        lease: Duration,
        now: Instant,
    ) -> Result<(), String> {
        let rules = build_rules(allow)?;
        self.active = None;
        self.backend.install(&rules)?;
        self.active = Some(Active {
            allow: allow.to_vec(),
            lease,
            lease_until: now + lease,
            stuck: false,
        });
        Ok(())
    }

    /// The addresses the current block lets through, or `None` when nothing is blocked.
    pub fn allowed(&self) -> Option<&[Ipv4Addr]> {
        self.active.as_ref().map(|active| active.allow.as_slice())
    }

    /// Starts the lease over. False when nothing is blocked.
    pub fn renew(&mut self, now: Instant) -> bool {
        match &mut self.active {
            Some(active) => {
                active.lease_until = now + active.lease;
                true
            }
            None => false,
        }
    }

    /// Removes the filters now.
    pub fn release(&mut self) -> Result<(), String> {
        let Some(active) = &mut self.active else {
            return Ok(());
        };
        match self.backend.remove() {
            Ok(()) => {
                self.active = None;
                Ok(())
            }
            Err(error) => {
                active.stuck = true;
                Err(error)
            }
        }
    }

    pub fn tick(&mut self, now: Instant) -> Tick {
        match &self.active {
            Some(active) if active.stuck || now >= active.lease_until => {
                Tick::Released(self.release())
            }
            _ => Tick::Idle,
        }
    }
}

impl<B: FilterBackend> Drop for NetBlock<B> {
    fn drop(&mut self) {
        if self.active.is_some() {
            if let Err(error) = self.backend.remove() {
                tracing::error!(%error, "internet filters could not be removed on drop");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::rc::Rc;

    use super::*;

    #[derive(Default)]
    struct Shared {
        installed: usize,
        installs: usize,
        fail_install: bool,
        fail_remove: bool,
    }

    struct Fake(Rc<RefCell<Shared>>);

    impl FilterBackend for Fake {
        fn install(&mut self, rules: &[Rule]) -> Result<(), String> {
            let mut s = self.0.borrow_mut();
            s.installed = 0;
            if s.fail_install {
                return Err("access denied".to_string());
            }
            s.installed = rules.len();
            s.installs += 1;
            Ok(())
        }

        fn remove(&mut self) -> Result<(), String> {
            let mut s = self.0.borrow_mut();
            if s.fail_remove {
                return Err("busy".to_string());
            }
            s.installed = 0;
            Ok(())
        }
    }

    const LEASE: Duration = Duration::from_secs(180);

    fn teacher() -> Vec<Ipv4Addr> {
        vec![Ipv4Addr::new(192, 168, 1, 10)]
    }

    fn setup() -> (NetBlock<Fake>, Rc<RefCell<Shared>>, Instant) {
        let shared = Rc::new(RefCell::new(Shared::default()));
        (NetBlock::new(Fake(shared.clone())), shared, Instant::now())
    }

    #[test]
    fn apply_installs_the_rules_and_marks_the_block_active() {
        let (mut block, shared, now) = setup();
        block.apply(&teacher(), LEASE, now).expect("apply");
        assert!(block.is_active());
        assert!(shared.borrow().installed > 0);
    }

    #[test]
    fn applying_again_replaces_instead_of_stacking() {
        let (mut block, shared, now) = setup();
        block.apply(&teacher(), LEASE, now).expect("first");
        let first = shared.borrow().installed;
        block.apply(&teacher(), LEASE, now).expect("second");
        assert_eq!(shared.borrow().installed, first);
        assert_eq!(shared.borrow().installs, 2);
    }

    #[test]
    fn bad_input_changes_nothing() {
        let (mut block, shared, now) = setup();
        block.apply(&teacher(), LEASE, now).expect("apply");
        assert!(block.apply(&[], LEASE, now).is_err());
        assert!(block.is_active());
        assert_eq!(shared.borrow().installs, 1);
    }

    #[test]
    fn a_failed_install_leaves_nothing_blocked() {
        let (mut block, shared, now) = setup();
        shared.borrow_mut().fail_install = true;
        assert_eq!(
            block.apply(&teacher(), LEASE, now),
            Err("access denied".into())
        );
        assert!(!block.is_active());
        assert_eq!(shared.borrow().installed, 0);
    }

    #[test]
    fn a_failed_replacement_also_ends_the_block() {
        let (mut block, shared, now) = setup();
        block.apply(&teacher(), LEASE, now).expect("first");
        shared.borrow_mut().fail_install = true;
        assert!(block.apply(&teacher(), LEASE, now).is_err());
        assert!(!block.is_active());
        assert_eq!(shared.borrow().installed, 0);
    }

    #[test]
    fn the_lease_ends_the_block_at_its_deadline_and_not_before() {
        let (mut block, shared, now) = setup();
        block.apply(&teacher(), LEASE, now).expect("apply");
        assert!(matches!(
            block.tick(now + LEASE - Duration::from_secs(1)),
            Tick::Idle
        ));
        assert!(block.is_active());
        assert!(matches!(block.tick(now + LEASE), Tick::Released(Ok(()))));
        assert!(!block.is_active());
        assert_eq!(shared.borrow().installed, 0);
        assert!(matches!(block.tick(now + LEASE * 2), Tick::Idle));
    }

    #[test]
    fn renewing_pushes_the_deadline_out_by_a_full_lease() {
        let (mut block, _shared, now) = setup();
        block.apply(&teacher(), LEASE, now).expect("apply");
        let later = now + Duration::from_secs(120);
        assert!(block.renew(later));
        assert!(matches!(block.tick(now + LEASE), Tick::Idle));
        assert!(matches!(block.tick(later + LEASE), Tick::Released(Ok(()))));
    }

    #[test]
    fn renewing_with_nothing_blocked_does_nothing() {
        let (mut block, _shared, now) = setup();
        assert!(!block.renew(now));
    }

    #[test]
    fn release_removes_the_filters_and_is_safe_to_repeat() {
        let (mut block, shared, now) = setup();
        block.apply(&teacher(), LEASE, now).expect("apply");
        block.release().expect("release");
        block.release().expect("again");
        assert!(!block.is_active());
        assert_eq!(shared.borrow().installed, 0);
    }

    #[test]
    fn a_failed_removal_is_reported_and_retried_on_the_next_tick() {
        let (mut block, shared, now) = setup();
        block.apply(&teacher(), LEASE, now).expect("apply");
        shared.borrow_mut().fail_remove = true;
        assert!(block.release().is_err());
        assert!(block.is_active());
        // Stuck: retried even though the lease has not run out.
        assert!(matches!(block.tick(now), Tick::Released(Err(_))));
        shared.borrow_mut().fail_remove = false;
        assert!(matches!(block.tick(now), Tick::Released(Ok(()))));
        assert!(!block.is_active());
    }

    #[test]
    fn dropping_a_block_removes_the_filters() {
        let (mut block, shared, now) = setup();
        block.apply(&teacher(), LEASE, now).expect("apply");
        drop(block);
        assert_eq!(shared.borrow().installed, 0);
    }
}
