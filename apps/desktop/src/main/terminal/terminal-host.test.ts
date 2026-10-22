import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalExit } from '@examguard/shared';
import { TerminalHost, type PtyProcess } from './terminal-host.js';
import type { TerminalLaunch } from './terminal-launch.js';

class FakePty implements PtyProcess {
  written: string[] = [];
  sizes: [number, number][] = [];
  killed = false;
  private data: (d: string) => void = () => {};
  private exit: (code: number) => void = () => {};
  onData(l: (d: string) => void) {
    this.data = l;
  }
  onExit(l: (code: number) => void) {
    this.exit = l;
  }
  write(d: string) {
    this.written.push(d);
  }
  resize(c: number, r: number) {
    this.sizes.push([c, r]);
  }
  kill() {
    this.killed = true;
    this.exit(1); // node-pty reports the exit after a kill
  }
  emit(d: string) {
    this.data(d);
  }
  end(code: number) {
    this.exit(code);
  }
}

const launch: TerminalLaunch = {
  file: 'eg-runner.exe',
  args: [],
  cwd: 'C:\\ws',
  env: {},
  nonce: 'n0nce',
};
const marker = (line: string, nonce = 'n0nce') =>
  `\x1b]6973;${nonce};${Buffer.from(line, 'utf8').toString('base64')}\x07`;
const size = { cols: 100, rows: 30 };

let ptys: FakePty[];
let data: string[];
let exits: TerminalExit[];
let host: TerminalHost;
let commands: string[];
let opens: number;

beforeEach(() => {
  vi.useFakeTimers();
  ptys = [];
  data = [];
  exits = [];
  commands = [];
  opens = 0;
  host = new TerminalHost({
    spawn: (l, s) => {
      expect(l).toBe(launch);
      const p = new FakePty();
      p.sizes.push([s.cols, s.rows]);
      ptys.push(p);
      return p;
    },
    onData: (d) => data.push(d),
    onExit: (e) => exits.push(e),
    onCommand: (line) => commands.push(line),
    onOpen: () => (opens += 1),
    flushMs: 16,
  });
});
afterEach(() => vi.useRealTimers());

describe('TerminalHost', () => {
  it('starts one shell and only resizes it on a second open', () => {
    const prepare = vi.fn(() => launch);
    host.open(prepare, size);
    host.open(prepare, { cols: 80, rows: 20 });
    expect(ptys).toHaveLength(1);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(ptys[0]?.sizes).toEqual([
      [100, 30],
      [80, 20],
    ]);
    expect(host.isOpen).toBe(true);
  });

  it('batches output before pushing it', () => {
    host.open(() => launch, size);
    ptys[0]?.emit('PS C:\\ws> ');
    ptys[0]?.emit('npm i lodash');
    expect(data).toEqual([]);
    vi.advanceTimersByTime(16);
    expect(data).toEqual(['PS C:\\ws> npm i lodash']);
  });

  it('passes input and resizes to the shell', () => {
    host.open(() => launch, size);
    host.write('dir\r');
    host.resize({ cols: 120, rows: 40 });
    expect(ptys[0]?.written).toEqual(['dir\r']);
    expect(ptys[0]?.sizes.at(-1)).toEqual([120, 40]);
  });

  it('close kills the shell, flushes what is left and reports closed', () => {
    host.open(() => launch, size);
    ptys[0]?.emit('last line');
    host.close();
    expect(ptys[0]?.killed).toBe(true);
    expect(data).toEqual(['last line']);
    expect(exits).toEqual([{ exitCode: 1, reason: 'closed' }]);
    expect(host.isOpen).toBe(false);
    host.close(); // nothing open: no second exit
    expect(exits).toHaveLength(1);
  });

  it('reports a shell that ended by itself and can start again', () => {
    host.open(() => launch, size);
    ptys[0]?.end(0);
    expect(exits).toEqual([{ exitCode: 0, reason: 'exited' }]);
    host.open(() => launch, size);
    expect(ptys).toHaveLength(2);
  });

  it('ignores input when no shell is open', () => {
    host.write('x');
    host.resize(size);
    expect(ptys).toHaveLength(0);
  });

  it('takes command markers out of the output and reports the lines', () => {
    host.open(() => launch, size);
    expect(opens).toBe(1);
    ptys[0]?.emit(`npm i lodash${marker('npm i lodash')}\r\n`);
    ptys[0]?.emit(marker('dir', 'other'));
    vi.advanceTimersByTime(16);
    expect(commands).toEqual(['npm i lodash']);
    expect(data.join('')).toBe(`npm i lodash\r\n${marker('dir', 'other')}`);
  });

  it('reports turned_off when the switch closes it', () => {
    host.open(() => launch, size);
    host.close('turned_off');
    expect(exits).toEqual([{ exitCode: 1, reason: 'turned_off' }]);
  });

  it('does not keep a half-started shell when preparing fails', () => {
    expect(() =>
      host.open(() => {
        throw new Error('eg-runner missing');
      }, size),
    ).toThrow('eg-runner missing');
    expect(host.isOpen).toBe(false);
  });
});
