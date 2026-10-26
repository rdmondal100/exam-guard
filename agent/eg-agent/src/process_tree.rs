//! Who started whom, so a window of a program the exam app launched (a code run's window) counts as
//! the exam's own and not as the student leaving it.

use std::collections::HashMap;
use std::os::windows::io::AsRawHandle;

use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};

use crate::win::owned;

/// More levels than any real chain; also stops a loop made by a reused process id.
const MAX_DEPTH: usize = 16;

/// `pid -> parent pid` for every process right now. Empty when the snapshot fails.
pub fn parent_map() -> HashMap<u32, u32> {
    let mut parents = HashMap::new();
    // SAFETY: plain call; the handle is owned and closed on drop.
    let snapshot = match owned(
        unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) },
        "CreateToolhelp32Snapshot",
    ) {
        Ok(snapshot) => snapshot,
        Err(error) => {
            tracing::warn!(%error, "could not list the processes");
            return parents;
        }
    };
    let handle = snapshot.as_raw_handle();
    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..PROCESSENTRY32W::default()
    };
    // SAFETY: `entry` has its size set; the handle stays valid while `snapshot` lives.
    let mut more = unsafe { Process32FirstW(handle, &mut entry) } != 0;
    while more {
        parents.insert(entry.th32ProcessID, entry.th32ParentProcessID);
        // SAFETY: as above.
        more = unsafe { Process32NextW(handle, &mut entry) } != 0;
    }
    parents
}

/// `pid` is `ancestor` or was started, directly or through others, by it.
pub fn is_descendant(parents: &HashMap<u32, u32>, pid: u32, ancestor: u32) -> bool {
    let mut current = pid;
    for _ in 0..MAX_DEPTH {
        if current == ancestor {
            return true;
        }
        match parents.get(&current) {
            Some(&parent) if parent != 0 && parent != current => current = parent,
            _ => return false,
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chain() -> HashMap<u32, u32> {
        // 10 started 20, 20 started 30, 30 started 40; 99 is unrelated.
        HashMap::from([(40, 30), (30, 20), (20, 10), (10, 1), (99, 1)])
    }

    #[test]
    fn a_process_is_its_own_ancestor_and_so_are_its_children() {
        let parents = chain();
        assert!(is_descendant(&parents, 10, 10));
        assert!(is_descendant(&parents, 20, 10));
        assert!(is_descendant(&parents, 40, 10));
    }

    #[test]
    fn unrelated_and_older_processes_are_not() {
        let parents = chain();
        assert!(!is_descendant(&parents, 99, 10));
        assert!(!is_descendant(&parents, 10, 40));
        assert!(!is_descendant(&parents, 555, 10));
    }

    #[test]
    fn a_parent_loop_ends() {
        let parents = HashMap::from([(1, 2), (2, 1)]);
        assert!(!is_descendant(&parents, 1, 3));
    }

    #[test]
    fn our_own_process_descends_from_itself_in_the_real_list() {
        let parents = parent_map();
        let me = std::process::id();
        assert!(parents.contains_key(&me));
        assert!(is_descendant(&parents, me, me));
        let parent = parents[&me];
        assert!(is_descendant(&parents, me, parent));
    }
}
