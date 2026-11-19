import { EyeIcon, FolderIcon, GraduationCapIcon, SendIcon, SquareTerminalIcon } from 'lucide-react';
import type { AnswerStatus, SessionStatus } from '@examguard/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { AppMark } from '../common/AppMark';
import { LINK_TEXT, LINK_TONE } from '../../pages/student/LobbyScreen';
import { ExamTimer } from './ExamTimer';
import { SaveChip } from './SaveChip';
import { SubmitStatus } from './SubmitStatus';

interface Props {
  examTitle: string;
  name: string;
  /** A practice exam (M53): a Practice badge instead of Monitoring active. */
  practice: boolean;
  /** Files button: shown when the teacher allows the panel. */
  filesOn: boolean;
  filesShown: boolean;
  onToggleFiles: () => void;
  /** Terminal button: shown while allowed, or while the shell is still open. */
  terminalButton: boolean;
  terminalShown: boolean;
  onToggleTerminal: () => void;
  saveStatus: AnswerStatus;
  link: SessionStatus['link'];
  offsetMs: number | null;
  deadline: number;
  /** The teacher paused the exam (M58): the timer stands still. */
  pausedAt: number | null;
  timeUp: boolean;
  onSubmit: () => void;
  /** A Submit is waiting for the server (M64): shown here, so it stays visible. */
  submitBusy: boolean;
  submitError: string | null;
  onRetrySubmit: () => void;
}

/** The exam window's toolbar (M51): who and what on the left, tools, status and time on the right. */
export function ExamHeader(props: Props) {
  const { filesShown, terminalShown, link } = props;
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <AppMark />
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">{props.examTitle}</h1>
          <p className="truncate text-xs text-muted-foreground">{props.name}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {props.filesOn && (
          <Button
            type="button"
            size="sm"
            variant={filesShown ? 'secondary' : 'outline'}
            aria-pressed={filesShown}
            onClick={props.onToggleFiles}
          >
            <FolderIcon />
            {filesShown ? 'Hide files' : 'Files'}
          </Button>
        )}
        {props.terminalButton && (
          <Button
            type="button"
            size="sm"
            variant={terminalShown ? 'secondary' : 'outline'}
            aria-pressed={terminalShown}
            onClick={props.onToggleTerminal}
          >
            <SquareTerminalIcon />
            {terminalShown ? 'Hide terminal' : 'Terminal'}
          </Button>
        )}
        <Separator orientation="vertical" className="mx-1 h-6!" />
        {props.practice ? (
          <Badge variant="secondary" className="h-7 px-2.5">
            <GraduationCapIcon aria-hidden />
            Practice exam
          </Badge>
        ) : (
          <Badge variant="info" className="h-7 px-2.5">
            <EyeIcon aria-hidden />
            Monitoring active
          </Badge>
        )}
        <SaveChip status={props.saveStatus} online={link === 'connected'} />
        <Badge role="status" variant={LINK_TONE[link]} className="h-7 gap-1.5 px-2.5">
          <span className="size-1.5 rounded-full bg-current" aria-hidden />
          {LINK_TEXT[link]}
        </Badge>
        <ExamTimer deadline={props.deadline} offsetMs={props.offsetMs} pausedAt={props.pausedAt} />
        <SubmitStatus
          busy={props.submitBusy}
          error={props.submitError}
          linkOk={link === 'connected'}
          onRetry={props.onRetrySubmit}
        />
        <Button
          type="button"
          disabled={props.timeUp || props.pausedAt !== null || props.submitBusy}
          onClick={props.onSubmit}
        >
          <SendIcon />
          Submit
        </Button>
      </div>
    </header>
  );
}
