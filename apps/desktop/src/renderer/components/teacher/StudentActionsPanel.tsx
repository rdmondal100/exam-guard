import { useState } from 'react';
import {
  MAX_EXTENSION_MINUTES,
  MAX_TEACHER_MESSAGE,
  type ExamState,
  type RosterEntry,
  type StudentAction,
} from '@examguard/shared';
import { Button } from '@/components/ui/button';
import type { ExamApi } from '@/api/examApi';
import {
  EXTEND_CHOICES,
  actionDoneText,
  availableActions,
  confirmText,
} from '@/lib/studentActions';

interface Props {
  examId: string;
  examState: ExamState;
  api: ExamApi;
  student: RosterEntry;
}

/**
 * The teacher's actions for one student (M35): a message or warning popup, lock and unlock, extra
 * time, ending their exam and resetting their session. The result shows up live in the roster.
 */
export function StudentActionsPanel({ examId, examState, api, student: s }: Props) {
  const [text, setText] = useState('');
  const [minutes, setMinutes] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const can = availableActions(examState, s);

  if (!Object.values(can).some(Boolean)) return null;

  const run = async (action: StudentAction) => {
    const question = confirmText(action, s);
    if (question && !window.confirm(question)) return;
    setBusy(true);
    try {
      const result = await api.studentAction(examId, s.id, action);
      setNotice({ ok: true, text: actionDoneText(action, result) });
      if (action.type === 'message') setText('');
      if (action.type === 'extend') setMinutes('');
    } catch (e) {
      setNotice({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const message = text.trim();
  const custom = Number(minutes);
  const customOk = Number.isInteger(custom) && custom >= 1 && custom <= MAX_EXTENSION_MINUTES;
  const danger = 'border-red-300 text-red-700';

  return (
    <section
      aria-label="Actions"
      className="flex flex-col gap-2 rounded-md border border-border p-3"
    >
      {can.message && (
        <div className="flex flex-col gap-2">
          <textarea
            aria-label="Message to the student"
            value={text}
            maxLength={MAX_TEACHER_MESSAGE}
            rows={2}
            placeholder="Shown as a popup on the student's screen"
            onChange={(e) => setText(e.target.value)}
            className="w-full resize-none rounded-md border border-border bg-card px-2 py-1 text-sm"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !message}
              onClick={() => void run({ type: 'message', kind: 'info', text: message })}
            >
              Send message
            </Button>
            <Button
              size="sm"
              variant="outline"
              className={danger}
              disabled={busy || !message}
              onClick={() => void run({ type: 'message', kind: 'warning', text: message })}
            >
              Send warning
            </Button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {can.lock && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void run({ type: 'lock' })}
          >
            Lock screen
          </Button>
        )}
        {can.unlock && (
          <Button
            size="sm"
            variant="outline"
            className={danger}
            disabled={busy}
            onClick={() => void run({ type: 'unlock' })}
          >
            Unlock
          </Button>
        )}
        {can.extend && (
          <span className="flex flex-wrap items-center gap-1 text-sm">
            Extra time:
            {EXTEND_CHOICES.map((m) => (
              <Button
                key={m}
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void run({ type: 'extend', minutes: m })}
              >
                +{m} min
              </Button>
            ))}
            <input
              aria-label="Minutes to add"
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
              onClick={() => void run({ type: 'extend', minutes: custom })}
            >
              Add
            </Button>
          </span>
        )}
      </div>
      {(can.end || can.reset) && (
        <div className="flex flex-wrap gap-2">
          {can.end && (
            <Button
              size="sm"
              variant="outline"
              className={danger}
              disabled={busy}
              onClick={() => void run({ type: 'end' })}
            >
              End exam for this student
            </Button>
          )}
          {can.reset && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              title="Signs the student out so they can join again, for example from another PC"
              onClick={() => void run({ type: 'reset_session' })}
            >
              Reset session
            </Button>
          )}
        </div>
      )}
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
