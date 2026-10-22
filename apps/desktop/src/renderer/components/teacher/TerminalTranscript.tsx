import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

/**
 * A student's terminal output replayed in a read-only xterm.js, so colours and cursor moves look
 * as they did on the student's screen. Loaded lazily (default export).
 */
export default function TerminalTranscript({ text }: { text: string }) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!box.current) return undefined;
    const t = new Terminal({
      fontFamily: 'Consolas, "Cascadia Mono", monospace',
      fontSize: 12,
      disableStdin: true,
      cursorBlink: false,
      scrollback: 50_000,
      theme: { background: '#111827' },
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.open(box.current);
    f.fit();
    t.write(text);
    const observer = new ResizeObserver(() => {
      if (box.current?.offsetWidth) f.fit();
    });
    observer.observe(box.current);
    return () => {
      observer.disconnect();
      t.dispose();
    };
  }, [text]);

  return <div ref={box} className="h-full min-h-0 overflow-hidden rounded-md bg-[#111827] p-1" />;
}
