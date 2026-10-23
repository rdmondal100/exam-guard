import { useEffect, useState } from 'react';
import type { AgentReport, AgentState } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import { useAgentStatus } from '@/lib/useAgentStatus';

const LABELS: Record<AgentState, string> = {
  running: 'Monitoring agent running',
  stopped: 'Monitoring agent stopped',
  missing: 'Monitoring agent not installed',
  unknown: 'Monitoring agent starting…',
};

const REPORT_MS = 2000;

/** Small corner badge. Opening it shows what the agent has seen lately (spike view, M19). */
export function AgentChip() {
  const { status } = useAgentStatus(3000);
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<AgentReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const load = () => window.examguard.agentReport().then(setReport, () => undefined);
    void load();
    const timer = setInterval(load, REPORT_MS);
    return () => clearInterval(timer);
  }, [open]);

  if (!status) return null;
  const ok = status.link.ok;

  const remove = async () => {
    setError(null);
    const result = await window.examguard.uninstallAgent().catch(() => null);
    if (!result?.ok) setError(result?.error ?? 'The agent could not be removed.');
  };

  return (
    <div className="fixed bottom-3 right-3 z-50 flex max-w-sm flex-col items-end gap-2 text-xs">
      {open && (
        <div className="w-80 space-y-2 rounded-md border bg-white p-3 shadow-lg">
          <p className="font-medium">What the agent saw</p>
          {report && report.lines.length > 0 ? (
            <ul className="space-y-1 font-mono text-[11px] leading-tight break-words">
              {report.lines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">Nothing logged yet. Switch to another window.</p>
          )}
          {report && <p className="text-muted">{report.shotCount} screenshots saved</p>}
          {error && (
            <p role="alert" className="text-red-800">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => window.examguard.openAgentFolder()}>
              Open folder
            </Button>
            {status.canUninstall && !status.fake && (
              <Button size="sm" variant="outline" onClick={remove}>
                Remove agent
              </Button>
            )}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-full border bg-white px-3 py-1 shadow"
        aria-expanded={open}
      >
        <span className={`size-2 rounded-full ${ok ? 'bg-green-600' : 'bg-red-600'}`} aria-hidden />
        {ok || status.state !== 'running'
          ? LABELS[status.state]
          : (status.link.problems[0] ?? LABELS.running)}
        {status.fake && ' (fake)'}
      </button>
    </div>
  );
}
