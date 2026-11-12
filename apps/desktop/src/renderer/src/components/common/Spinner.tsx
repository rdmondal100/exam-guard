import { Loader2Icon } from 'lucide-react';
import { cn } from '@/lib/utils';

/** A spinning icon for buttons and loading lines; decorative, so pair it with text. */
export function Spinner({ className }: { className?: string }) {
  return <Loader2Icon aria-hidden className={cn('size-4 animate-spin', className)} />;
}

/** "Loading …" with a spinner, for Suspense fallbacks and first loads. */
export function LoadingLine({ children, className }: { children: string; className?: string }) {
  return (
    <p className={cn('flex items-center gap-2 text-sm text-muted-foreground', className)}>
      <Spinner />
      {children}
    </p>
  );
}
