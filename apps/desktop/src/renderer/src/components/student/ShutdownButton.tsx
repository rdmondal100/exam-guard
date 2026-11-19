import { useState } from 'react';
import { PowerIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/hooks/useConfirm';
import { ipcErrorText } from '@/lib/ipcError';

interface Props {
  /**
   * The student has a receipt, so the answers are known to be on the teacher's computer. Without
   * one (the exam ended first) the button says nothing about the answers (M60).
   */
  submitted?: boolean;
}

/**
 * "Shut down this PC" after the answers are safe on the teacher's computer (M57). The teacher's
 * roster then shows the student as "submitted · left". Main refuses it before a submit.
 */
export function ShutdownButton({ submitted = true }: Props) {
  const confirm = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const shutDown = async () => {
    const ok = await confirm({
      title: 'Shut down this computer?',
      description: submitted
        ? 'Your answers are already saved on the teacher’s computer. Windows shuts down in a few seconds.'
        : 'The exam has ended. Windows shuts down in a few seconds.',
      confirmLabel: 'Shut down',
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await window.examguard.shutdownPc();
    } catch (e) {
      setError(ipcErrorText(e));
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">
        {submitted
          ? 'Your answers are safe on the teacher’s computer. You can turn off this computer now.'
          : 'The exam has ended. You can turn off this computer now.'}
      </p>
      <Button variant="outline" className="w-fit" disabled={busy} onClick={() => void shutDown()}>
        <PowerIcon />
        {busy ? 'Shutting down…' : 'Shut down this PC'}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
