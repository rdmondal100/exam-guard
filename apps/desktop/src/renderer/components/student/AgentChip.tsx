import { useState } from 'react';
import type { AgentState } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import { useAgentStatus } from '@/hooks/useAgentStatus';

const LABELS: Record<AgentState, string> = {
  running: 'Monitoring agent running',
  stopped: 'Monitoring agent stopped',
  missing: 'Monitoring agent not installed',
  unknown: 'Monitoring agent starting…',
};

/** Small corner badge with the agent's state. In dev builds, opening it offers to remove the agent. */
export function AgentChip() {
  const { status } = useAgentStatus(3000);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!status) return null;
  const ok = status.link.ok;
  const removable = status.canUninstall && !status.fake;

  const remove = async () => {
    setError(null);
    const result = await window.examguard.uninstallAgent().catch(() => null);
    if (!result?.ok) setError(result?.error ?? 'The agent could not be removed.');
  };

  return (
    <div className="fixed bottom-3 right-3 z-50 flex max-w-sm flex-col items-end gap-2 text-xs">
      {open && removable && (
        <div className="w-64 space-y-2 rounded-md border bg-white p-3 shadow-lg">
          {error && (
            <p role="alert" className="text-red-800">
              {error}
            </p>
          )}
          <Button size="sm" variant="outline" onClick={remove}>
            Remove agent
          </Button>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-full border bg-white px-3 py-1 shadow"
        aria-expanded={removable ? open : undefined}
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
