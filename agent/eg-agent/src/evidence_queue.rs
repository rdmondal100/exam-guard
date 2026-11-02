//! Evidence the helper and the process watcher reported and the app has not acknowledged yet. The
//! app gets it over the app pipe and acks what the server stored (`evidence.ack`); until then it is
//! kept and sent again to every app connection. With a buffer (the service and `--console`) each
//! entry is written to the encrypted disk buffer and only its number stays in memory, so the
//! evidence outlives an app kill, an agent restart or a reboot (M24).

use std::collections::VecDeque;
use std::sync::{Mutex, PoisonError};

use crate::buffer::{BufferRoot, StudentBuffer};
use crate::pipe_msg::EvidenceBody;

/// Oldest entries are dropped beyond this (a screenshot is a few hundred KB). Only numbers are in
/// memory when the disk buffer is used, so it may hold more.
const MAX_IN_MEMORY: usize = 100;
const MAX_ON_DISK: usize = 500;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Stored {
    pub evidence_seq: u64,
    pub body: EvidenceBody,
}

struct Entry {
    seq: u64,
    /// `None`: the body is in the disk buffer.
    body: Option<EvidenceBody>,
}

struct Inner {
    next: u64,
    items: VecDeque<Entry>,
    disk: Option<StudentBuffer>,
}

impl Inner {
    fn limit(&self) -> usize {
        if self.disk.is_some() {
            MAX_ON_DISK
        } else {
            MAX_IN_MEMORY
        }
    }

    fn forget(&self, entry: &Entry) {
        if entry.body.is_none() {
            if let Some(disk) = &self.disk {
                disk.remove(entry.seq);
            }
        }
    }
}

pub struct EvidenceQueue {
    inner: Mutex<Inner>,
    root: Option<BufferRoot>,
}

impl EvidenceQueue {
    /// In memory only. `first_seq` is the number of the first entry. A new agent run starts higher
    /// than the last one, so the numbers (and the app's dedupe keys) never repeat.
    pub fn new(first_seq: u64) -> Self {
        Self::build(first_seq, None)
    }

    /// Backed by the encrypted disk buffer once a student is adopted.
    pub fn with_buffer(first_seq: u64, root: BufferRoot) -> Self {
        Self::build(first_seq, Some(root))
    }

    fn build(first_seq: u64, root: Option<BufferRoot>) -> Self {
        Self {
            inner: Mutex::new(Inner {
                next: first_seq,
                items: VecDeque::new(),
                disk: None,
            }),
            root,
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Keeps the evidence and returns its number.
    pub fn push(&self, body: EvidenceBody) -> u64 {
        let mut inner = self.lock();
        let seq = inner.next;
        inner.next += 1;
        if inner.items.len() >= inner.limit() {
            if let Some(oldest) = inner.items.pop_front() {
                inner.forget(&oldest);
            }
            tracing::warn!("evidence queue full, dropped the oldest entry");
        }
        let on_disk = match &inner.disk {
            Some(disk) => match disk.put(seq, &body) {
                Ok(()) => true,
                Err(error) => {
                    tracing::warn!(%error, seq, "could not buffer evidence on disk; kept in memory");
                    false
                }
            },
            None => false,
        };
        let body = (!on_disk).then_some(body);
        inner.items.push_back(Entry { seq, body });
        seq
    }

    /// Every entry numbered above `after`, oldest first. An entry whose file is gone or no longer
    /// decrypts is dropped.
    pub fn after(&self, after: u64) -> Vec<Stored> {
        let mut inner = self.lock();
        let mut found = Vec::new();
        let mut lost = Vec::new();
        for entry in inner.items.iter().filter(|e| e.seq > after) {
            let body = match &entry.body {
                Some(body) => Some(body.clone()),
                None => inner.disk.as_ref().and_then(|disk| disk.get(entry.seq)),
            };
            match body {
                Some(body) => found.push(Stored {
                    evidence_seq: entry.seq,
                    body,
                }),
                None => lost.push(entry.seq),
            }
        }
        if !lost.is_empty() {
            tracing::warn!(?lost, "buffered evidence could not be read, dropped");
            inner.items.retain(|e| !lost.contains(&e.seq));
        }
        found
    }

    /// The server has stored everything up to and including `up_to`.
    pub fn ack(&self, up_to: u64) {
        let mut inner = self.lock();
        while inner.items.front().is_some_and(|e| e.seq <= up_to) {
            if let Some(entry) = inner.items.pop_front() {
                inner.forget(&entry);
            }
        }
    }

    /// The evidence from now on belongs to `student`. What another student left is forgotten (also
    /// on disk); what this student left on disk (before an agent restart or a reboot) is taken
    /// back, to be sent to the app again.
    pub fn adopt(&self, student: &str) {
        let mut inner = self.lock();
        let previous = std::mem::take(&mut inner.items);
        for entry in &previous {
            inner.forget(entry);
        }
        inner.disk = None;
        let Some(root) = &self.root else { return };
        let disk = match root.student(student) {
            Ok(disk) => disk,
            Err(error) => {
                tracing::error!(%error, "the evidence buffer is not usable; keeping evidence in memory");
                return;
            }
        };
        let seqs = disk.load();
        if let Some(&last) = seqs.last() {
            inner.next = inner.next.max(last + 1);
            tracing::info!(
                entries = seqs.len(),
                "buffered evidence taken back from disk"
            );
        }
        inner.items = seqs
            .into_iter()
            .map(|seq| Entry { seq, body: None })
            .collect();
        inner.disk = Some(disk);
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.lock().items.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::buffer::tests::temp_root;
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
        for _ in 0..(MAX_IN_MEMORY + 5) {
            queue.push(body("focus_lost"));
        }
        assert_eq!(queue.len(), MAX_IN_MEMORY);
        assert_eq!(queue.after(0)[0].evidence_seq, 6);
    }

    #[test]
    fn another_student_forgets_but_numbering_goes_on() {
        let queue = EvidenceQueue::new(1);
        queue.push(body("focus_lost"));
        queue.adopt("s2");
        assert_eq!(queue.len(), 0);
        assert_eq!(queue.push(body("focus_lost")), 2);
    }

    #[test]
    fn buffered_evidence_survives_a_new_queue_and_an_ack_deletes_it_from_disk() {
        let root = temp_root();
        {
            let queue = EvidenceQueue::with_buffer(10, BufferRoot::open(&root, None).unwrap());
            queue.adopt("s1");
            queue.push(body("focus_lost"));
            queue.push(body("focus_returned"));
            queue.push(body("title_changed"));
            queue.ack(10);
        }
        // The agent restarted (a lower start number than the entries on disk).
        let queue = EvidenceQueue::with_buffer(5, BufferRoot::open(&root, None).unwrap());
        assert!(
            queue.after(0).is_empty(),
            "nothing before a student is adopted"
        );
        queue.adopt("s1");
        let kinds: Vec<String> = queue.after(0).into_iter().map(|s| s.body.kind).collect();
        assert_eq!(kinds, vec!["focus_returned", "title_changed"]);
        assert_eq!(
            queue.push(body("still_outside")),
            13,
            "numbers go on after the disk's"
        );
        queue.ack(13);
        assert_eq!(fs_entries(&root.join("s1")), 0);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_deleted_buffer_file_drops_only_that_entry() {
        let root = temp_root();
        let queue = EvidenceQueue::with_buffer(1, BufferRoot::open(&root, None).unwrap());
        queue.adopt("s1");
        queue.push(body("a"));
        queue.push(body("b"));
        for entry in std::fs::read_dir(root.join("s1")).unwrap().flatten() {
            if entry
                .file_name()
                .to_string_lossy()
                .starts_with("00000000000000000001")
            {
                std::fs::remove_file(entry.path()).unwrap();
            }
        }
        let left: Vec<u64> = queue.after(0).iter().map(|s| s.evidence_seq).collect();
        assert_eq!(left, vec![2]);
        assert_eq!(queue.len(), 1);
        std::fs::remove_dir_all(&root).unwrap();
    }

    fn fs_entries(dir: &std::path::Path) -> usize {
        std::fs::read_dir(dir).map_or(0, |d| d.flatten().count())
    }
}
