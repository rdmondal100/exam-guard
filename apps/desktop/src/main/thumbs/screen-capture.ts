import { desktopCapturer, screen } from 'electron';

/** JPEG quality of a grid thumbnail: about 10–20 KB at 320 px (docs/architecture.md §5). */
const THUMB_QUALITY = 50;

/**
 * The whole primary screen (not just the exam window) as a JPEG at most `width` px wide, kept in
 * proportion. `null` when Windows gives no picture (for example on the secure desktop).
 */
export async function captureScreenJpeg(width: number): Promise<Uint8Array | null> {
  const primary = screen.getPrimaryDisplay();
  const { width: w, height: h } = primary.size;
  const height = Math.max(1, Math.round((width * h) / Math.max(1, w)));
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height },
  });
  const source = sources.find((s) => s.display_id === String(primary.id)) ?? sources[0];
  if (!source || source.thumbnail.isEmpty()) return null;
  return new Uint8Array(source.thumbnail.toJPEG(THUMB_QUALITY));
}
