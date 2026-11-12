import { useState } from 'react';
import { GlobeIcon, ImageIcon, ListIcon } from 'lucide-react';
import type { EventRow } from '@examguard/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ExamApi } from '@/api/examApi';
import { describeEvent, programCounts, urlOf } from '@/lib/eventsView';
import { clockTime } from '@/lib/terminalLog';
import { Hint } from '../common/Hint';
import { ScreenshotThumb } from './ScreenshotThumb';
import { SEVERITY_TEXT, SEVERITY_TONE } from './severityStyle';

interface Props {
  event: EventRow;
  api: ExamApi;
  onOpenShot: (event: EventRow) => void;
  /** Feed: the student's name, a click opens their detail. Timeline: left out. */
  onStudent?: (examStudentId: string) => void;
  /** Timeline: the screenshot inline instead of a button (M32). */
  inlineShot?: boolean;
}

/** One event: time, severity, what happened, and its picture, program list or web address. */
export function EventLine({ event: e, api, onOpenShot, onStudent, inlineShot = false }: Props) {
  const [listed, setListed] = useState(false);
  const [addressShown, setAddressShown] = useState(false);
  const programs = e.type === 'processes_at_start' ? programCounts(e.details) : [];
  const url = urlOf(e.details);
  const text = describeEvent(e);
  return (
    <li className="flex flex-wrap items-center gap-3 px-1 py-2 text-sm">
      <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">
        {clockTime(e.serverTs)}
      </span>
      <Badge variant={SEVERITY_TONE[e.severity]} className="w-16">
        {e.severity}
      </Badge>
      {onStudent && (
        <button
          type="button"
          className="w-40 shrink-0 truncate text-left hover:underline disabled:no-underline"
          disabled={!e.examStudentId}
          onClick={() => e.examStudentId && onStudent(e.examStudentId)}
        >
          <span className="font-mono text-muted-foreground">{e.studentCode}</span>{' '}
          <span className="font-medium">{e.studentName}</span>
        </button>
      )}
      <Hint label={text}>
        <span className={cn('min-w-0 flex-1 truncate', SEVERITY_TEXT[e.severity])}>{text}</span>
      </Hint>
      <div className="flex shrink-0 items-center gap-1">
        {programs.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            aria-expanded={listed}
            onClick={() => setListed(!listed)}
          >
            <ListIcon />
            Programs
          </Button>
        )}
        {url && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            aria-expanded={addressShown}
            onClick={() => setAddressShown(!addressShown)}
          >
            <GlobeIcon />
            Address
          </Button>
        )}
        {e.hasScreenshot &&
          (inlineShot ? (
            <ScreenshotThumb event={e} api={api} onOpen={onOpenShot} />
          ) : (
            <Button size="sm" variant="outline" className="h-7" onClick={() => onOpenShot(e)}>
              <ImageIcon />
              Screenshot
            </Button>
          ))}
      </div>
      {addressShown && (
        <p
          aria-label="Web address"
          className="w-full rounded-md bg-muted px-2 py-1 pl-20 font-mono text-xs break-all text-muted-foreground select-text"
        >
          {url}
        </p>
      )}
      {listed && (
        <ul
          aria-label="Programs running at the start"
          className="w-full columns-2 rounded-md bg-muted px-2 py-1 pl-20 text-xs"
        >
          {programs.map(({ exe, count }) => (
            <li key={exe} className="font-mono">
              {exe}
              {count > 1 ? ` ×${count}` : ''}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
