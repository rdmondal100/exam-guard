import { ShieldCheckIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/** The app's mark: a shield in the brand colour, with or without the name. */
export function AppMark({
  withName = false,
  className,
}: {
  withName?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <ShieldCheckIcon className="size-4.5" aria-hidden />
      </div>
      {withName && <span className="truncate font-semibold">ExamGuard AI</span>}
    </div>
  );
}
