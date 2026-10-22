import { COMMAND_OSC } from './shell-init.js';

const PREFIX = `\x1b]${COMMAND_OSC};`;
const BEL = '\x07';
/** A marker longer than this is not ours (input is capped at 64 KB, base64 adds a third). */
const MAX_MARKER = 96 * 1024;

export interface MarkerResult {
  /** Output with our markers removed. */
  text: string;
  /** Command lines, in order. */
  commands: string[];
}

/** Length of the longest suffix of `s` that is a proper prefix of `PREFIX`. */
function partialPrefixAt(s: string): number {
  for (let n = Math.min(PREFIX.length - 1, s.length); n > 0; n -= 1) {
    if (s.endsWith(PREFIX.slice(0, n))) return n;
  }
  return 0;
}

/**
 * Pulls the shell's command markers out of the pty output stream. A marker may be split across
 * chunks, so an incomplete one is held back until the next chunk. Markers with another nonce are
 * passed through as ordinary output.
 */
export class CommandMarkerParser {
  private carry = '';

  constructor(private readonly nonce: string) {}

  push(chunk: string): MarkerResult {
    let data = this.carry + chunk;
    this.carry = '';
    let text = '';
    const commands: string[] = [];
    for (;;) {
      const start = data.indexOf(PREFIX);
      if (start < 0) {
        const keep = partialPrefixAt(data);
        text += data.slice(0, data.length - keep);
        this.carry = data.slice(data.length - keep);
        break;
      }
      const end = data.indexOf(BEL, start + PREFIX.length);
      if (end < 0) {
        if (data.length - start > MAX_MARKER) {
          // Not a marker of ours after all: let it through.
          text += data;
        } else {
          text += data.slice(0, start);
          this.carry = data.slice(start);
        }
        break;
      }
      const body = data.slice(start + PREFIX.length, end);
      const line = this.decode(body);
      if (line === null) text += data.slice(0, end + 1);
      else {
        text += data.slice(0, start);
        commands.push(line);
      }
      data = data.slice(end + 1);
    }
    return { text, commands };
  }

  /** Whatever is held back, once the stream has ended. */
  flush(): string {
    const rest = this.carry;
    this.carry = '';
    return rest;
  }

  private decode(body: string): string | null {
    const sep = body.indexOf(';');
    if (sep < 0 || body.slice(0, sep) !== this.nonce) return null;
    const b64 = body.slice(sep + 1);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return null;
    return Buffer.from(b64, 'base64').toString('utf8');
  }
}
