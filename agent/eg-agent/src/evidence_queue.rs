//! Evidence the helper reported and the app has not acknowledged yet. The app gets it over the app
//! pipe and acks what the server stored (`evidence.ack`); until then it is kept and sent again to
//! every app connection. In memory only: the encrypted disk buffer is M24.

use std::collections::VecDeque;
use std::sync::{Mutex, PoisonError};

use crate::pipe_msg::EvidenceBody;

/// Oldest entries are dropped beyond this (a screenshot is a few hundred KB).
const MAX_ENTRIES: usize = 100;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Stored {
    pub evidence_seq: u64,
    pub body: EvidenceBody,
}

struct Inner {
    next: u64,
    items: VecDeque<Stored>,
}

pub struct EvidenceQueue {
    inner: Mutex<Inner>,
}

impl EvidenceQueue {
    /// `first_seq` is the number of the first entry. A new agent run starts higher than the last
    /// one, so the numbers (and the app's dedupe keys) never repeat.
    pub fn new(first_seq: u64) -> Self {
        Self {
            inner: Mutex::new(Inner {
                next: first_seq,
                items: VecDeque::new(),
            }),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Keeps the evidence and returns its number.
    pub fn push(&self, body: EvidenceBody) -> u64 {
        let mut inner = self.lock();
        let evidence_seq = inner.next;
        inner.next += 1;
        if inner.items.len() >= MAX_ENTRIES {
            inner.items.pop_front();
            tracing::warn!("evidence queue full, dropped the oldest entry");
        }
        inner.items.push_back(Stored { evidence_seq, body });
        evidence_seq
    }

    /// Every entry numbered above `after`, oldest first.
    pub fn after(&self, after: u64) -> Vec<Stored> {
        self.lock()
            .items
            .iter()
            .filter(|stored| stored.evidence_seq > after)
            .cloned()
            .collect()
    }

    /// The server has stored everything up to and including `up_to`.
    pub fn ack(&self, up_to: u64) {
        self.lock()
            .items
            .retain(|stored| stored.evidence_seq > up_to);
    }

    /// Forgets everything, for another student's exam.
    pub fn clear(&self) {
        self.lock().items.clear();
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.lock().items.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pipe_msg::EvidenceData;

    fn body(kind: &str) -> EvidenceBody {
        EvidenceBody {
            ts: 1,
            kind: kind.into(),
            data: EvidenceData::default(),
            screenshot: None,
        }
    }

    #[test]
    fn entries_are_numbered_from_the_first_number_and_listed_in_order() {
        let queue = EvidenceQueue::new(1000);
        assert_eq!(queue.push(body("focus_lost")), 1000);
        assert_eq!(queue.push(body("focus_returned")), 1001);
        let all = queue.after(0);
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].body.kind, "focus_lost");
        assert_eq!(queue.after(1000).len(), 1);
        assert!(queue.after(1001).is_empty());
    }

    #[test]
    fn an_ack_removes_everything_up_to_it() {
        let queue = EvidenceQueue::new(1);
        for _ in 0..5 {
            queue.push(body("focus_lost"));
        }
        queue.ack(3);
        let left: Vec<u64> = queue.after(0).iter().map(|s| s.evidence_seq).collect();
        assert_eq!(left, vec![4, 5]);
        queue.ack(100);
        assert_eq!(queue.len(), 0);
    }

    #[test]
    fn the_queue_keeps_only_the_newest_entries() {
        let queue = EvidenceQueue::new(1);
        for _ in 0..(MAX_ENTRIES + 5) {
            queue.push(body("focus_lost"));
        }
        assert_eq!(queue.len(), MAX_ENTRIES);
        assert_eq!(queue.after(0)[0].evidence_seq, 6);
    }

    #[test]
    fn clear_forgets_but_numbering_goes_on() {
        let queue = EvidenceQueue::new(1);
        queue.push(body("focus_lost"));
        queue.clear();
        assert_eq!(queue.len(), 0);
        assert_eq!(queue.push(body("focus_lost")), 2);
    }
}
