import { describe, expect, it } from 'vitest';
import { PASTE_PREVIEW_CHARS, PasteBlockedReportSchema } from './clipboard.js';
import { StudentMessageSchema } from '../protocol/ws.js';

describe('PasteBlockedReportSchema (M25)', () => {
  const report = { surface: 'editor', chars: 12, lines: 2, preview: 'int main()' };

  it('accepts a report with or without a suppressed count', () => {
    expect(PasteBlockedReportSchema.safeParse(report).success).toBe(true);
    expect(PasteBlockedReportSchema.safeParse({ ...report, suppressed: 3 }).success).toBe(true);
  });

  it('rejects an unknown surface and a preview that is too long', () => {
    expect(PasteBlockedReportSchema.safeParse({ ...report, surface: 'clipboard' }).success).toBe(
      false,
    );
    const preview = 'x'.repeat(PASTE_PREVIEW_CHARS + 1);
    expect(PasteBlockedReportSchema.safeParse({ ...report, preview }).success).toBe(false);
  });

  it('paste_blocked is an app event on the student socket', () => {
    const event = {
      t: 'event',
      id: 'p1',
      dedupeKey: 'p1',
      clientTs: 1,
      type: 'paste_blocked',
      details: report,
    };
    expect(StudentMessageSchema.safeParse(event).success).toBe(true);
  });
});
