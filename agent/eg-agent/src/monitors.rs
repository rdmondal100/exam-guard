//! How many screens Windows shows the desktop on.

use windows_sys::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CMONITORS};

/// The display monitors that are part of the desktop. A mirrored (duplicate) display counts once.
pub fn count() -> u32 {
    // SAFETY: no pointers involved.
    let monitors = unsafe { GetSystemMetrics(SM_CMONITORS) };
    u32::try_from(monitors).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_count_is_a_small_number() {
        // A headless build agent may have none; a PC has a few at most.
        assert!(count() < 32);
    }
}
