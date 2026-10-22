import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { TerminalExit } from '@examguard/shared';
import { Button } from '@/components/ui/button';

type Phase = 'idle' | 'opening' | 'open' | 'closed';

const DIM = '\x1b[90m';
const RESET = '\x1b[0m';
const EXIT_TEXT: Record<TerminalExit['reason'], string> = {
  closed: 'Terminal closed',
  exited: 'Terminal ended',
  turned_off: 'Terminal turned off by the teacher',
};

/**
 * The exam terminal (xterm.js). The shell itself runs in student main (node-pty inside a Job
 * Object); this view only sends keystrokes and shows output over IPC. It stays mounted while
 * hidden and across questions, so the scrollback is kept.
 */
export default function TerminalDock() {
  const box = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const phaseRef = useRef<Phase>('idle');
  phaseRef.current = phase;

  const size = () => ({
    cols: Math.max(2, term.current?.cols ?? 80),
    rows: Math.max(2, term.current?.rows ?? 24),
  });

  const open = async () => {
    setPhase('opening');
    setMessage('');
    const result = await window.examguard.openTerminal(size()).catch((e: unknown) => ({
      ok: false as const,
      message: e instanceof Error ? e.message : 'The terminal could not start.',
    }));
    if (result.ok) {
      setPhase('open');
      term.current?.focus();
    } else {
      setPhase('idle');
      setMessage(result.message);
    }
  };

  useEffect(() => {
    if (!box.current) return;
    const t = new Terminal({
      fontFamily: 'Consolas, "Cascadia Mono", monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      theme: { background: '#111827' },
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.open(box.current);
    term.current = t;
    fit.current = f;
    const input = t.onData((data) => {
      if (phaseRef.current === 'open') window.examguard.terminalInput(data);
    });
    const offData = window.examguard.onTerminalData((data) => t.write(data));
    const offExit = window.examguard.onTerminalExit((exit) => {
      const code = exit.exitCode === null ? '' : ` (exit ${exit.exitCode})`;
      t.write(`\r\n${DIM}[${EXIT_TEXT[exit.reason]}${code}]${RESET}\r\n`);
      setPhase('closed');
    });
    // Fit to the box whenever it changes size (including when the dock is first shown).
    const observer = new ResizeObserver(() => {
      if (!box.current?.offsetWidth) return;
      f.fit();
      if (phaseRef.current === 'open') window.examguard.resizeTerminal(size());
    });
    observer.observe(box.current);
    // After a renderer reload the shell may still be running in main: reattach to it.
    void window.examguard.terminalStatus().then((s) => {
      if (s.open) void open();
    });
    return () => {
      observer.disconnect();
      input.dispose();
      offData();
      offExit();
      t.dispose();
      term.current = null;
    };
  }, []); // set up once per mount

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-3 text-sm">
        <span className="font-medium">Terminal</span>
        <span className="text-muted">
          PowerShell in your exam workspace: npm, pacman, gcc. Your teacher sees the commands and
          output.
        </span>
        <div className="ml-auto flex items-center gap-2">
          {message && <span className="text-red-700">{message}</span>}
          {phase === 'open' ? (
            <Button
              className="h-8 px-3"
              variant="outline"
              onClick={() => void window.examguard.closeTerminal()}
            >
              Close terminal
            </Button>
          ) : (
            <Button className="h-8 px-3" onClick={() => void open()} disabled={phase === 'opening'}>
              {phase === 'opening'
                ? 'Starting…'
                : phase === 'closed'
                  ? 'Start again'
                  : 'Start terminal'}
            </Button>
          )}
        </div>
      </div>
      <div ref={box} className="min-h-0 flex-1 overflow-hidden rounded-md bg-[#111827] p-1" />
    </div>
  );
}
