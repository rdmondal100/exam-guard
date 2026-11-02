import { useState } from 'react';
import { MAX_EXTENSION_MINUTES, MAX_TEACHER_MESSAGE, type HostingCounts } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import type { ExamApi } from '@/api/examApi';
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
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async (question: string, action: () => Promise<string>) => {
    if (!window.confirm(question)) return;
    setBusy(true);
    try {
      setNotice({ ok: true, text: await action() });
    } catch (e) {
      setNotice({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const broadcast = (kind: 'info' | 'warning') =>
    void run(broadcastQuestion(kind, counts), async () => {
      const result = await api.broadcast(examId, { kind, text: message });
      setText('');
      return broadcastDoneText(result);
    });

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
      className="flex flex-col gap-2 rounded-md border border-border p-3"
    >
      <h3 className="font-semibold">Everyone</h3>
      <textarea
        aria-label="Message to every student"
        value={text}
        maxLength={MAX_TEACHER_MESSAGE}
        rows={2}
        placeholder="Shown as a popup on every joined student's screen"
        onChange={(e) => setText(e.target.value)}
        className="w-full resize-none rounded-md border border-border bg-card px-2 py-1 text-sm"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !message}
          onClick={() => broadcast('info')}
        >
          Message everyone
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="border-red-300 text-red-700"
          disabled={busy || !message}
          onClick={() => broadcast('warning')}
        >
          Warn everyone
        </Button>
        {running && (
          <span className="ml-auto flex flex-wrap items-center gap-1 text-sm">
            Extra time for all:
            {EXTEND_ALL_CHOICES.map((m) => (
              <Button key={m} size="sm" variant="outline" disabled={busy} onClick={() => extend(m)}>
                +{m} min
              </Button>
            ))}
            <input
              aria-label="Minutes to add for everyone"
              inputMode="numeric"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ''))}
              placeholder="min"
              className="h-8 w-14 rounded-md border border-border bg-card px-2"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !customOk}
              onClick={() => extend(custom)}
            >
              Add
            </Button>
          </span>
        )}
      </div>
      {notice && (
        <p
          role={notice.ok ? 'status' : 'alert'}
          className={`text-sm ${notice.ok ? 'text-green-800' : 'text-red-700'}`}
        >
          {notice.text}
        </p>
      )}
    </section>
  );
}
