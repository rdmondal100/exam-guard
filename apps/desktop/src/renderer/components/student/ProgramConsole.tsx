import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useRunStore } from '@/lib/runStore';

const HINT = '\x1b[90mPress Run. Type here while the program runs.\x1b[0m';

interface Props {
  /** `questionId.language`: the console replays that buffer's last output when it mounts. */
  runKey: string;
  /** A run of this buffer is going: it gets the keyboard. */
  active: boolean;
  /** Hidden (another tab is showing) but still mounted, so it keeps receiving output. */
  hidden: boolean;
}

/**
 * The console a run happens in (xterm.js). The program runs in student main inside a
 * pseudo-console; this view only forwards keystrokes and shows output over IPC. It is cleared
 * when a new run starts and replays the last output of its buffer when it is mounted again.
 */
export default function ProgramConsole({ runKey, active, hidden }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const activeRef = useRef(active);
  const wasActive = useRef(false);
  activeRef.current = active;

  useEffect(() => {
    if (!box.current) return;
    const t = new Terminal({
      fontFamily: 'Consolas, "Cascadia Mono", monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 2000,
      convertEol: false,
      theme: { background: '#111827' },
    });
    const fit = new FitAddon();
    t.loadAddon(fit);
    t.open(box.current);
    term.current = t;
    const replay = useRunStore.getState().results[runKey]?.stdout;
    t.write(replay || HINT);
    const input = t.onData((data) => {
      if (activeRef.current) window.examguard.runInput(data);
    });
    const offData = window.examguard.onRunData((data) => t.write(data));
    // Main keeps the last size, so the next run starts with the right one.
    const observer = new ResizeObserver(() => {
      if (!box.current?.offsetWidth) return;
      fit.fit();
      window.examguard.resizeRun({ cols: Math.max(2, t.cols), rows: Math.max(2, t.rows) });
    });
    observer.observe(box.current);
    return () => {
      observer.disconnect();
      input.dispose();
      offData();
      t.dispose();
      term.current = null;
    };
  }, [runKey]);

  useEffect(() => {
    if (active && !wasActive.current) {
      term.current?.reset();
      term.current?.focus();
    }
    wasActive.current = active;
  }, [active]);

  return (
    <div
      ref={box}
      className={`min-h-0 flex-1 overflow-hidden rounded-md bg-[#111827] p-1 ${hidden ? 'hidden' : ''}`}
    />
  );
}
