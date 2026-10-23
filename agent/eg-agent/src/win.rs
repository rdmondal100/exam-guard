//! Small Win32 helpers shared by the agent modules.

use std::os::windows::io::{FromRawHandle, OwnedHandle};

use windows_sys::Win32::Foundation::{HANDLE, INVALID_HANDLE_VALUE};

pub fn last_error(what: &str) -> String {
    format!("{what} failed: {}", std::io::Error::last_os_error())
}

pub fn check(ok: i32, what: &str) -> Result<(), String> {
    if ok == 0 {
        Err(last_error(what))
    } else {
        Ok(())
    }
}

pub fn owned(handle: HANDLE, what: &str) -> Result<OwnedHandle, String> {
    if handle.is_null() || handle == INVALID_HANDLE_VALUE {
        return Err(last_error(what));
    }
    // SAFETY: the handle was just returned by the OS and is owned by nobody else.
    Ok(unsafe { OwnedHandle::from_raw_handle(handle) })
}

/// NUL-terminated UTF-16 for `*W` calls.
pub fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wide_ends_with_nul() {
        assert_eq!(wide("ab"), vec![97, 98, 0]);
    }
}
