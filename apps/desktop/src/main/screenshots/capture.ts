import { desktopCapturer, screen, type Rectangle } from 'electron';

/** JPEG quality of a grid thumbnail: about 10–20 KB at 320 px (docs/architecture.md §5). */
const THUMB_QUALITY = 50;

export interface CaptureOptions {
  /** JPEG quality, 1–100. */
  quality?: number;
  /** Capture the screen this window is on (screen pixels, as get-windows gives them). */
  near?: Rectangle;
}

/** The screen a window is on, or the primary one. */
function displayFor(near: Rectangle | undefined) {
  if (!near) return screen.getPrimaryDisplay();
  try {
    return screen.getDisplayMatching(screen.screenToDipRect(null, near));
  } catch {
    return screen.getPrimaryDisplay();
  }
}

/**
 * One whole screen (not just a window) as a JPEG at most `width` px wide, kept in proportion: the
 * primary screen, or the one a window is on. `null` when Windows gives no picture (for example on
 * the lock screen). The picture stays in memory.
 */
export async function captureScreenJpeg(
  width: number,
  { quality = THUMB_QUALITY, near }: CaptureOptions = {},
): Promise<Uint8Array | null> {
  const display = displayFor(near);
  const { width: w, height: h } = display.size;
  const height = Math.max(1, Math.round((width * h) / Math.max(1, w)));
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height },
  });
  const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
  if (!source || source.thumbnail.isEmpty()) return null;
  return new Uint8Array(source.thumbnail.toJPEG(quality));
}
