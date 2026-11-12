import { useEffect, useState } from 'react';
import { MessageSquareIcon, TriangleAlertIcon } from 'lucide-react';
import type { TeacherMessageToStudent } from '@examguard/shared';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { clockTime } from '@/lib/terminalLog';
import { queueMessage } from '@/lib/teacherMessages';

/**
 * Teacher messages and warnings (M35) as popups, one at a time and oldest first, above everything
 * else (also the lock screen, `z-[60]`). The student closes each with OK; Esc does nothing.
 */
export function TeacherMessagePopup() {
  const [queue, setQueue] = useState<TeacherMessageToStudent[]>([]);

  useEffect(
    () => window.examguard.onTeacherMessage((message) => setQueue((q) => queueMessage(q, message))),
    [],
  );

  const current = queue[0];
  const warning = current?.kind === 'warning';
  const Icon = warning ? TriangleAlertIcon : MessageSquareIcon;
  return (
    <AlertDialog open={current !== undefined}>
      <AlertDialogContent
        className={cn('z-[60] border-2', warning ? 'border-destructive' : 'border-primary')}
        overlayClassName="z-[60]"
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {current && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle
                className={cn(
                  'flex items-center gap-2 text-xl',
                  warning ? 'text-destructive' : 'text-primary',
                )}
              >
                <Icon className="size-5" aria-hidden />
                {warning ? 'Warning from your teacher' : 'Message from your teacher'}
              </AlertDialogTitle>
              <AlertDialogDescription className="text-lg break-words whitespace-pre-wrap text-foreground">
                {current.text}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="items-center sm:justify-between">
              <span className="text-sm text-muted-foreground">
                {clockTime(current.sentAt)}
                {queue.length > 1 ? ` · ${queue.length - 1} more` : ''}
              </span>
              <Button autoFocus onClick={() => setQueue((q) => q.slice(1))}>
                OK
              </Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
