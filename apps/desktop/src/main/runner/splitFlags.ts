/**
 * Splits the flags a student typed into argv entries: spaces separate, `"..."` and `'...'` group.
 * No backslash escapes (Windows paths use them) and nothing is run through a shell. Returns
 * `null` for text that cannot be flags (control characters, an unclosed quote).
 */
export function splitFlags(text: string): string[] | null {
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000a-\u001f\u007f]/.test(text)) return null;
  const out: string[] = [];
  let current = '';
  let started = false;
  let quote: '"' | "'" | null = null;
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (ch === ' ' || ch === '\t') {
      if (started) out.push(current);
      current = '';
      started = false;
    } else {
      current += ch;
      started = true;
    }
  }
  if (quote) return null;
  if (started) out.push(current);
  return out;
}
