//! Screenshot of the whole virtual screen (all monitors) with GDI, downscaled and JPEG-encoded.
//! The spike checks whether GDI `BitBlt` from a SYSTEM helper sees the real desktop (architecture §3).

use std::ffi::c_void;
use std::ptr::null_mut;

use windows_sys::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GdiFlush, GetDC,
    ReleaseDC, SelectObject, SetBrushOrgEx, SetStretchBltMode, StretchBlt, BITMAPINFO,
    BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS, HALFTONE, HBITMAP, HDC, HGDIOBJ, SRCCOPY,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
};

use crate::win::{check, last_error};

pub const MAX_WIDTH: u32 = 1600;
pub const JPEG_QUALITY: u8 = 60;

/// One captured frame, top-down BGRA.
pub struct Shot {
    pub width: u32,
    pub height: u32,
    /// Size of the virtual screen before scaling.
    pub source: (u32, u32),
    pub bgra: Vec<u8>,
}

/// Fits `width × height` into `max_width`, keeping the aspect ratio. Never upscales.
pub fn scaled_size(width: u32, height: u32, max_width: u32) -> (u32, u32) {
    if width <= max_width || width == 0 {
        return (width, height);
    }
    let h = (u64::from(height) * u64::from(max_width) + u64::from(width) / 2) / u64::from(width);
    (max_width, u32::try_from(h.max(1)).unwrap_or(u32::MAX))
}

/// How dark a frame is: a black capture (wrong desktop, protected content) has almost no lit pixels.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BlackStats {
    /// Mean luma 0–255.
    pub mean_luma: f32,
    /// Share of pixels with luma above 16.
    pub lit_share: f32,
}

impl BlackStats {
    pub fn is_black(&self) -> bool {
        self.lit_share < 0.01
    }
}

pub fn black_stats(bgra: &[u8]) -> BlackStats {
    let mut sum = 0u64;
    let mut lit = 0u64;
    let mut count = 0u64;
    for px in bgra.chunks_exact(4) {
        let luma =
            (u32::from(px[2]) * 299 + u32::from(px[1]) * 587 + u32::from(px[0]) * 114) / 1000;
        sum += u64::from(luma);
        lit += u64::from(luma > 16);
        count += 1;
    }
    if count == 0 {
        return BlackStats {
            mean_luma: 0.0,
            lit_share: 0.0,
        };
    }
    BlackStats {
        mean_luma: sum as f32 / count as f32,
        lit_share: lit as f32 / count as f32,
    }
}

/// GDI objects freed in reverse order on drop.
struct Gdi {
    screen: HDC,
    memory: HDC,
    bitmap: HBITMAP,
    old: HGDIOBJ,
}

impl Drop for Gdi {
    fn drop(&mut self) {
        // SAFETY: each handle is either null or was created in `grab` and not freed elsewhere.
        unsafe {
            if !self.old.is_null() {
                SelectObject(self.memory, self.old);
            }
            if !self.bitmap.is_null() {
                DeleteObject(self.bitmap);
            }
            if !self.memory.is_null() {
                DeleteDC(self.memory);
            }
            if !self.screen.is_null() {
                ReleaseDC(null_mut(), self.screen);
            }
        }
    }
}

/// Captures the virtual screen, scaled to at most `max_width` pixels wide.
pub fn grab(max_width: u32) -> Result<Shot, String> {
    // SAFETY: plain GDI calls; every handle is checked and freed by `Gdi`.
    unsafe {
        let x = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let y = GetSystemMetrics(SM_YVIRTUALSCREEN);
        let cx = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        let cy = GetSystemMetrics(SM_CYVIRTUALSCREEN);
        let (src_w, src_h) = (
            u32::try_from(cx).unwrap_or(0),
            u32::try_from(cy).unwrap_or(0),
        );
        if src_w == 0 || src_h == 0 {
            return Err("the virtual screen has no size (no desktop?)".to_string());
        }
        let (w, h) = scaled_size(src_w, src_h, max_width);
        let (wi, hi) = (w as i32, h as i32);

        let mut gdi = Gdi {
            screen: GetDC(null_mut()),
            memory: null_mut(),
            bitmap: null_mut(),
            old: null_mut(),
        };
        if gdi.screen.is_null() {
            return Err(last_error("GetDC(screen)"));
        }
        gdi.memory = CreateCompatibleDC(gdi.screen);
        if gdi.memory.is_null() {
            return Err(last_error("CreateCompatibleDC"));
        }
        let info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: wi,
                biHeight: -hi, // top-down rows
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bits: *mut c_void = null_mut();
        gdi.bitmap = CreateDIBSection(gdi.screen, &info, DIB_RGB_COLORS, &mut bits, null_mut(), 0);
        if gdi.bitmap.is_null() || bits.is_null() {
            return Err(last_error("CreateDIBSection"));
        }
        gdi.old = SelectObject(gdi.memory, gdi.bitmap);
        // CAPTUREBLT includes layered (translucent) windows.
        let rop = SRCCOPY | CAPTUREBLT;
        if (w, h) == (src_w, src_h) {
            check(
                BitBlt(gdi.memory, 0, 0, wi, hi, gdi.screen, x, y, rop),
                "BitBlt",
            )?;
        } else {
            SetStretchBltMode(gdi.memory, HALFTONE);
            SetBrushOrgEx(gdi.memory, 0, 0, null_mut());
            check(
                StretchBlt(gdi.memory, 0, 0, wi, hi, gdi.screen, x, y, cx, cy, rop),
                "StretchBlt",
            )?;
        }
        GdiFlush();
        let len = w as usize * h as usize * 4;
        let bgra = std::slice::from_raw_parts(bits.cast::<u8>().cast_const(), len).to_vec();
        Ok(Shot {
            width: w,
            height: h,
            source: (src_w, src_h),
            bgra,
        })
    }
}

pub fn encode_jpeg(shot: &Shot, quality: u8) -> Result<Vec<u8>, String> {
    let width = u16::try_from(shot.width).map_err(|_| "frame too wide for JPEG".to_string())?;
    let height = u16::try_from(shot.height).map_err(|_| "frame too tall for JPEG".to_string())?;
    let mut out = Vec::new();
    jpeg_encoder::Encoder::new(&mut out, quality)
        .encode(&shot.bgra, width, height, jpeg_encoder::ColorType::Bgra)
        .map_err(|error| format!("JPEG encode failed: {error}"))?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scaled_size_fits_and_keeps_aspect() {
        assert_eq!(scaled_size(3840, 2160, 1600), (1600, 900));
        assert_eq!(scaled_size(5760, 1080, 1600), (1600, 300));
        assert_eq!(scaled_size(1366, 768, 1600), (1366, 768));
        assert_eq!(scaled_size(1600, 1200, 1600), (1600, 1200));
        assert_eq!(scaled_size(100_000, 1, 1600), (1600, 1));
    }

    #[test]
    fn black_frame_is_black() {
        let black = vec![0u8; 4 * 100];
        assert!(black_stats(&black).is_black());
        // Black except for one pixel in a thousand (a cursor) is still black.
        let mut nearly = vec![0u8; 4 * 1000];
        nearly[..4].copy_from_slice(&[255, 255, 255, 0]);
        assert!(black_stats(&nearly).is_black());
    }

    #[test]
    fn desktop_like_frame_is_not_black() {
        // Half dark taskbar, half light window.
        let mut frame = vec![0u8; 4 * 200];
        for px in frame.chunks_exact_mut(4).skip(100) {
            px.copy_from_slice(&[240, 240, 240, 0]);
        }
        let stats = black_stats(&frame);
        assert!(!stats.is_black());
        assert!((stats.lit_share - 0.5).abs() < 0.001);
        assert!((stats.mean_luma - 120.0).abs() < 1.0);
    }

    #[test]
    fn encodes_a_jpeg() {
        let shot = Shot {
            width: 16,
            height: 8,
            source: (16, 8),
            bgra: vec![128u8; 16 * 8 * 4],
        };
        let jpeg = encode_jpeg(&shot, JPEG_QUALITY).unwrap();
        assert_eq!(&jpeg[..2], &[0xFF, 0xD8]);
        assert_eq!(&jpeg[jpeg.len() - 2..], &[0xFF, 0xD9]);
    }

    /// Real GDI capture of this session's screen (runs as the current user, no admin).
    #[test]
    fn grabs_the_real_screen() {
        let shot = grab(MAX_WIDTH).unwrap();
        assert!(shot.width <= MAX_WIDTH && shot.width > 0 && shot.height > 0);
        assert_eq!(
            (shot.width, shot.height),
            scaled_size(shot.source.0, shot.source.1, MAX_WIDTH)
        );
        assert_eq!(shot.bgra.len(), (shot.width * shot.height * 4) as usize);
        let jpeg = encode_jpeg(&shot, JPEG_QUALITY).unwrap();
        assert_eq!(&jpeg[..2], &[0xFF, 0xD8]);
    }
}
