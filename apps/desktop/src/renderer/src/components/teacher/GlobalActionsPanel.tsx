import { useState } from 'react';
import { MegaphoneIcon, MessageSquareIcon, TimerIcon, TriangleAlertIcon } from 'lucide-react';
import { toast } from 'sonner';
import { MAX_EXTENSION_MINUTES, MAX_TEACHER_MESSAGE, type HostingCounts } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { ExamApi } from '@/api/examApi';
import { useConfirm } from '@/hooks/useConfirm';
import {
  EXTEND_ALL_CHOICES,
  broadcastDoneText,
  broadcastQuestion,
  extendAllDoneText,
  extendAllQuestion,
} from '@/lib/globalActions';

interface Props {
  examId: string;
  api: ExamApi;
  /** Extra time for everyone needs a running exam; the broadcast also works in the lobby. */
  running: boolean;
  counts: HostingCounts | null;
  /** The exam's end changed; the hosting details reload. */
  onExtended: () => void;
}

/**
 * The teacher's actions for the whole exam (M36): a message or warning to every joined student
 * and extra time for everyone. Ending the exam for everyone is the "End exam now" button. Each
 * asks first and is written to the action log.
 */
export function GlobalActionsPanel({ examId, api, running, counts, onExtended }: Props) {
  const [text, setText] = useState('');
  const [minutes, setMinutes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();

  const run = async (question: string, action: () => Promise<string>, destructive = false) => {
    if (!(await confirm({ title: question, destructive }))) return;
    setBusy(true);
    setError(null);
    try {
      toast.success(await action());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const broadcast = (kind: 'info' | 'warning') =>
    void run(
      broadcastQuestion(kind, counts),
      async () => {
        const result = await api.broadcast(examId, { kind, text: message });
        setText('');
        return broadcastDoneText(result);
      },
      kind === 'warning',
    );

  const extend = (m: number) =>
    void run(extendAllQuestion(m, counts), async () => {
      const result = await api.extendAll(examId, m);
      setMinutes('');
      onExtended();
      return extendAllDoneText(m, result);
    });

  const message = text.trim();
  const custom = Number(minutes);
  const customOk = Number.isInteger(custom) && custom >= 1 && custom <= MAX_EXTENSION_MINUTES;

  return (
    <section
      aria-label="Actions for everyone"
      className="flex flex-col gap-3 rounded-lg border p-4"
    >
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <MegaphoneIcon className="size-4 text-muted-foreground" aria-hidden />
        Everyone
      </h3>
      <Textarea
        aria-label="Message to every student"
        value={text}
        maxLength={MAX_TEACHER_MESSAGE}
        rows={2}
        placeholder="Shown as a popup on every joined student's screen"
        onChange={(e) => setText(e.target.value)}
        className="min-h-0 resize-none"
      />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !message}
          onClick={() => broadcast('info')}
        >
          <MessageSquareIcon />
          Message everyone
        </Button>
        <Button
          size="sm"
          variant="outline-destructive"
          disabled={busy || !message}
          onClick={() => broadcast('warning')}
        >
          <TriangleAlertIcon />
          Warn everyone
        </Button>
      </div>
      {running && (
        <div className="flex flex-wrap items-center gap-1.5 border-t pt-3 text-sm">
          <span className="mr-1 flex items-center gap-1.5 text-muted-foreground">
            <TimerIcon className="size-4" aria-hidden />
            Extra time for all:
          </span>
          {EXTEND_ALL_CHOICES.map((m) => (
            <Button key={m} size="sm" variant="secondary" disabled={busy} onClick={() => extend(m)}>
              +{m} min
            </Button>
          ))}
          <Input
            aria-label="Minutes to add for everyone"
            inputMode="numeric"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ''))}
            placeholder="min"
            className="h-8 w-16"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !customOk}
            onClick={() => extend(custom)}
          >
            Add
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
