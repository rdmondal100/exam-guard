import { useState } from 'react';
import {
  LockIcon,
  LockOpenIcon,
  MessageSquareIcon,
  RotateCcwIcon,
  SquareIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  MAX_EXTENSION_MINUTES,
  MAX_TEACHER_MESSAGE,
  type ExamState,
  type RosterEntry,
  type StudentAction,
} from '@examguard/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { ExamApi } from '@/api/examApi';
import { useConfirm } from '@/hooks/useConfirm';
import {
  EXTEND_CHOICES,
  actionDoneText,
  availableActions,
  confirmText,
} from '@/lib/studentActions';
import { Hint } from '../common/Hint';

interface Props {
  examId: string;
  examState: ExamState;
  api: ExamApi;
  student: RosterEntry;
}

/** The actions that end or take something from the student get a red confirm button. */
const DESTRUCTIVE: ReadonlySet<StudentAction['type']> = new Set(['lock', 'end', 'reset_session']);

/**
 * The teacher's actions for one student (M35): a message or warning popup, lock and unlock, extra
 * time, ending their exam and resetting their session. The result shows up live in the roster.
 */
export function StudentActionsPanel({ examId, examState, api, student: s }: Props) {
  const [text, setText] = useState('');
  const [minutes, setMinutes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();
  const can = availableActions(examState, s);

  if (!Object.values(can).some(Boolean)) return null;

  const run = async (action: StudentAction) => {
    const question = confirmText(action, s);
    if (
      question &&
      !(await confirm({ title: question, destructive: DESTRUCTIVE.has(action.type) }))
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.studentAction(examId, s.id, action);
      toast.success(actionDoneText(action, result));
      if (action.type === 'message') setText('');
      if (action.type === 'extend') setMinutes('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const message = text.trim();
  const custom = Number(minutes);
  const customOk = Number.isInteger(custom) && custom >= 1 && custom <= MAX_EXTENSION_MINUTES;

  return (
    <section aria-label="Actions" className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
      {can.message && (
        <div className="flex flex-col gap-2">
          <Textarea
            aria-label="Message to the student"
            value={text}
            maxLength={MAX_TEACHER_MESSAGE}
            rows={2}
            placeholder="Shown as a popup on the student's screen"
            onChange={(e) => setText(e.target.value)}
            className="min-h-0 resize-none"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !message}
              onClick={() => void run({ type: 'message', kind: 'info', text: message })}
            >
              <MessageSquareIcon />
              Send message
            </Button>
            <Button
              size="sm"
              variant="outline-destructive"
              disabled={busy || !message}
              onClick={() => void run({ type: 'message', kind: 'warning', text: message })}
            >
              <TriangleAlertIcon />
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
            <LockIcon />
            Lock screen
          </Button>
        )}
        {can.unlock && (
          <Button
            size="sm"
            variant="outline-destructive"
            disabled={busy}
            onClick={() => void run({ type: 'unlock' })}
          >
            <LockOpenIcon />
            Unlock
          </Button>
        )}
        {can.extend && (
          <span className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="text-muted-foreground">Extra time:</span>
            {EXTEND_CHOICES.map((m) => (
              <Button
                key={m}
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void run({ type: 'extend', minutes: m })}
              >
                +{m} min
              </Button>
            ))}
            <Input
              aria-label="Minutes to add"
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
              onClick={() => void run({ type: 'extend', minutes: custom })}
            >
              Add
            </Button>
          </span>
        )}
      </div>
      {(can.end || can.reset) && (
        <div className="flex flex-wrap gap-2 border-t pt-3">
          {can.end && (
            <Button
              size="sm"
              variant="outline-destructive"
              disabled={busy}
              onClick={() => void run({ type: 'end' })}
            >
              <SquareIcon />
              End exam for this student
            </Button>
          )}
          {can.reset && (
            <Hint label="Signs the student out so they can join again, for example from another PC">
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void run({ type: 'reset_session' })}
              >
                <RotateCcwIcon />
                Reset session
              </Button>
            </Hint>
          )}
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
