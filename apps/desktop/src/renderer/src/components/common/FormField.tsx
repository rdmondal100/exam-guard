import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  label: ReactNode;
  children: ReactNode;
  /** A short help line under the control. */
  hint?: ReactNode;
  /** Shown in red under the control; `role="alert"`. */
  error?: string | null;
  className?: string;
}

/**
 * A label with its control under it (M51). The `<label>` wraps the control, so no ids are needed;
 * the hint and error sit outside it so they don't become part of the control's name.
 */
export function FormField({ label, children, hint, error, className }: Props) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label className="flex flex-col gap-2 text-sm font-medium">
        <span>{label}</span>
        {children}
      </label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
