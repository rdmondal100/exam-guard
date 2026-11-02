//! The encrypted disk copy of evidence the app has not acknowledged (architecture §3). One folder
//! per student under the buffer root, one file per entry: a 12-byte nonce and the AES-256-GCM
//! ciphertext of the entry's JSON, with `<student>:<evidenceSeq>` as associated data, so a file
//! cannot be passed off as another entry. The key sits next to the folders; the root's access list
//! keeps a standard user from reading either. Files are removed when the server has stored them.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::ptr::null_mut;

use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng, Payload};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use windows_sys::Win32::Foundation::LocalFree;
use windows_sys::Win32::Security::Authorization::{
    ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
};
use windows_sys::Win32::Security::{PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES};
use windows_sys::Win32::Storage::FileSystem::CreateDirectoryW;

use crate::pipe_msg::EvidenceBody;
use crate::win::{last_error, wide};

const KEY_FILE: &str = "key.bin";
const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;
const EXT: &str = "bin";

/// The buffer folder and its key. Opening it creates both when they are missing.
pub struct BufferRoot {
    root: PathBuf,
    cipher: Aes256Gcm,
}

impl BufferRoot {
    /// `sddl` is the folder's access list (inherited by everything in it); `None` keeps the
    /// parent's, which is what `--console` uses.
    pub fn open(root: &Path, sddl: Option<&str>) -> Result<Self, String> {
        if let Some(parent) = root.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
        }
        match sddl {
            Some(sddl) if !root.exists() => create_protected_dir(root, sddl)?,
            _ => fs::create_dir_all(root).map_err(|e| format!("create {}: {e}", root.display()))?,
        }
        let key = load_or_create_key(&root.join(KEY_FILE))?;
        Ok(Self {
            root: root.to_path_buf(),
            cipher: Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key)),
        })
    }

    /// The folder of one student. Every other student's folder is deleted: the buffer only ever
    /// holds the student this PC is monitoring now.
    pub fn student(&self, student: &str) -> Result<StudentBuffer, String> {
        let name = folder_name(student);
        if let Ok(entries) = fs::read_dir(&self.root) {
            for entry in entries.flatten() {
                let other = entry.file_name();
                if entry.path().is_dir() && other.to_string_lossy() != name {
                    tracing::warn!(folder = %other.to_string_lossy(), "dropping another student's buffered evidence");
                    // A folder that cannot be deleted now is tried again at the next student.
                    let _ = fs::remove_dir_all(entry.path());
                }
            }
        }
        let dir = self.root.join(&name);
        fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
        Ok(StudentBuffer {
            dir,
            student: student.to_string(),
            cipher: self.cipher.clone(),
        })
    }
}

/// One student's entries on disk.
pub struct StudentBuffer {
    dir: PathBuf,
    student: String,
    cipher: Aes256Gcm,
}

impl StudentBuffer {
    fn path(&self, seq: u64) -> PathBuf {
        self.dir.join(format!("{seq:020}.{EXT}"))
    }

    fn aad(&self, seq: u64) -> Vec<u8> {
        format!("{}:{seq}", self.student).into_bytes()
    }

    /// Writes the entry (to a temporary name first, so a crash never leaves half a file).
    pub fn put(&self, seq: u64, body: &EvidenceBody) -> Result<(), String> {
        let json = serde_json::to_vec(body).map_err(|e| e.to_string())?;
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let aad = self.aad(seq);
        let sealed = self
            .cipher
            .encrypt(
                &nonce,
                Payload {
                    msg: &json,
                    aad: &aad,
                },
            )
            .map_err(|_| "encryption failed".to_string())?;
        let mut bytes = Vec::with_capacity(NONCE_LEN + sealed.len());
        bytes.extend_from_slice(&nonce);
        bytes.extend_from_slice(&sealed);
        let tmp = self.dir.join(format!("{seq:020}.tmp"));
        fs::write(&tmp, &bytes).map_err(|e| format!("write {}: {e}", tmp.display()))?;
        fs::rename(&tmp, self.path(seq)).map_err(|e| format!("rename {}: {e}", tmp.display()))
    }

    /// The entry, or `None` when it is missing or does not decrypt (another key, a damaged file).
    pub fn get(&self, seq: u64) -> Option<EvidenceBody> {
        let bytes = fs::read(self.path(seq)).ok()?;
        if bytes.len() <= NONCE_LEN {
            return None;
        }
        let (nonce, sealed) = bytes.split_at(NONCE_LEN);
        let aad = self.aad(seq);
        let json = self
            .cipher
            .decrypt(
                Nonce::from_slice(nonce),
                Payload {
                    msg: sealed,
                    aad: &aad,
                },
            )
            .ok()?;
        serde_json::from_slice(&json).ok()
    }

    pub fn remove(&self, seq: u64) {
        match fs::remove_file(self.path(seq)) {
            Err(error) if error.kind() != io::ErrorKind::NotFound => {
                tracing::warn!(%error, seq, "could not delete a buffered entry");
            }
            _ => {}
        }
    }

    /// The numbers of the readable entries, oldest first. Leftover temporary files and entries
    /// that do not decrypt are deleted.
    pub fn load(&self) -> Vec<u64> {
        let Ok(entries) = fs::read_dir(&self.dir) else {
            return Vec::new();
        };
        let mut seqs = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            let seq = path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .and_then(|stem| stem.parse::<u64>().ok());
            let is_entry = path.extension().is_some_and(|ext| ext == EXT);
            match seq {
                Some(seq) if is_entry && self.get(seq).is_some() => seqs.push(seq),
                _ => {
                    tracing::warn!(file = %path.display(), "dropping an unreadable buffer file");
                    let _ = fs::remove_file(&path);
                }
            }
        }
        seqs.sort_unstable();
        seqs
    }
}

/// A folder name for a student id: the id itself when it is plain, else its bytes in hex.
fn folder_name(student: &str) -> String {
    let plain = !student.is_empty()
        && student.len() <= 100
        && student
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if plain {
        student.to_string()
    } else {
        student.bytes().map(|b| format!("{b:02x}")).collect()
    }
}

fn load_or_create_key(path: &Path) -> Result<Vec<u8>, String> {
    if let Ok(key) = fs::read(path) {
        if key.len() == KEY_LEN {
            return Ok(key);
        }
        tracing::warn!("the buffer key is damaged; making a new one");
    }
    let key = Aes256Gcm::generate_key(&mut OsRng).to_vec();
    fs::write(path, &key).map_err(|e| format!("write {}: {e}", path.display()))?;
    Ok(key)
}

/// Creates `dir` with the access list `sddl`.
fn create_protected_dir(dir: &Path, sddl: &str) -> Result<(), String> {
    let mut descriptor: PSECURITY_DESCRIPTOR = null_mut();
    // SAFETY: the SDDL is NUL-terminated and the out pointer is valid.
    let converted = unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            wide(sddl).as_ptr(),
            SDDL_REVISION_1,
            &mut descriptor,
            null_mut(),
        )
    };
    if converted == 0 {
        return Err(last_error(
            "ConvertStringSecurityDescriptorToSecurityDescriptorW",
        ));
    }
    let attributes = SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: descriptor,
        bInheritHandle: 0,
    };
    let path = wide(&dir.to_string_lossy());
    // SAFETY: the path and the attributes outlive the call.
    let created = unsafe { CreateDirectoryW(path.as_ptr(), &attributes) };
    let result = if created == 0 {
        Err(last_error("CreateDirectoryW"))
    } else {
        Ok(())
    };
    // SAFETY: the descriptor was allocated by the conversion call above.
    unsafe { LocalFree(descriptor) };
    result
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::pipe_msg::{EvidenceData, Screenshot};
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    /// A fresh folder under the temp dir; the caller removes it.
    pub fn temp_root() -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        std::env::temp_dir().join(format!("eg-buffer-{}-{n}", std::process::id()))
    }

    fn body(kind: &str) -> EvidenceBody {
        EvidenceBody {
            ts: 5,
            kind: kind.into(),
            data: EvidenceData {
                exe: Some("chrome.exe".into()),
                ..EvidenceData::default()
            },
            screenshot: Some(Screenshot {
                jpeg_base64: "/9j/AAAA".into(),
                width: 4,
                height: 3,
            }),
        }
    }

    #[test]
    fn entries_round_trip_and_are_not_stored_in_the_clear() {
        let root = temp_root();
        let buffer = BufferRoot::open(&root, None)
            .unwrap()
            .student("s1")
            .unwrap();
        buffer.put(7, &body("focus_lost")).unwrap();
        assert_eq!(buffer.get(7), Some(body("focus_lost")));
        let raw = fs::read(buffer.path(7)).unwrap();
        assert!(!raw.windows(10).any(|w| w == b"chrome.exe"));
        buffer.remove(7);
        assert_eq!(buffer.get(7), None);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_reopened_buffer_keeps_its_key_and_lists_entries_in_order() {
        let root = temp_root();
        {
            let buffer = BufferRoot::open(&root, None)
                .unwrap()
                .student("s1")
                .unwrap();
            buffer.put(20, &body("a")).unwrap();
            buffer.put(3, &body("b")).unwrap();
        }
        let buffer = BufferRoot::open(&root, None)
            .unwrap()
            .student("s1")
            .unwrap();
        assert_eq!(buffer.load(), vec![3, 20]);
        assert_eq!(buffer.get(3).unwrap().kind, "b");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn an_entry_renamed_to_another_number_or_student_does_not_decrypt() {
        let root = temp_root();
        let opened = BufferRoot::open(&root, None).unwrap();
        let buffer = opened.student("s1").unwrap();
        buffer.put(1, &body("a")).unwrap();
        fs::rename(buffer.path(1), buffer.path(2)).unwrap();
        assert_eq!(buffer.get(2), None);
        fs::write(buffer.dir.join("junk.tmp"), b"x").unwrap();
        assert!(buffer.load().is_empty(), "the moved entry is dropped");
        assert!(!buffer.path(2).exists());
        assert!(!buffer.dir.join("junk.tmp").exists());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn another_student_clears_the_previous_folder_and_a_new_key_drops_old_entries() {
        let root = temp_root();
        let opened = BufferRoot::open(&root, None).unwrap();
        opened.student("s1").unwrap().put(1, &body("a")).unwrap();
        let s2 = opened.student("s2").unwrap();
        assert!(!root.join("s1").exists());
        s2.put(1, &body("b")).unwrap();
        fs::write(root.join(KEY_FILE), b"short").unwrap();
        let reopened = BufferRoot::open(&root, None)
            .unwrap()
            .student("s2")
            .unwrap();
        assert!(reopened.load().is_empty());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn odd_student_ids_become_hex_folder_names() {
        assert_eq!(folder_name("01HZ-abc_9"), "01HZ-abc_9");
        assert_eq!(folder_name("a/b"), "612f62");
        assert_eq!(folder_name(".."), "2e2e");
    }

    #[test]
    fn a_protected_root_is_created_with_its_access_list() {
        let root = temp_root();
        // The developer owns the folder here; the service passes a SYSTEM-only list.
        BufferRoot::open(&root, Some("D:P(A;OICI;FA;;;WD)")).unwrap();
        assert!(root.join(KEY_FILE).exists());
        fs::remove_dir_all(&root).unwrap();
    }
}
