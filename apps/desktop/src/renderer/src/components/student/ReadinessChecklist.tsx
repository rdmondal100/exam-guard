import { CircleCheckIcon, CircleXIcon, Loader2Icon } from 'lucide-react';
import { READINESS_CHECKS, READINESS_LABEL } from '@examguard/shared';
import { cn } from '@/lib/utils';
import { useReadiness } from '@/hooks/useReadiness';

/**
 * The lobby readiness check (M54) as the student sees it: each language and the disk with a tick
 * or a cross, so a student whose PC has a problem can raise a hand before the exam starts.
 */
export function ReadinessChecklist() {
  const report = useReadiness();
  const failed = report?.checks.some((c) => !c.ok) ?? false;
  return (
    <section aria-label="Computer check" className="flex flex-col gap-2 rounded-lg border p-3">
      <p className="text-sm font-medium">
        {report === null
          ? 'Checking this computer…'
          : failed
            ? 'Something on this computer is not working. Raise your hand.'
            : 'This computer is ready.'}
      </p>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
        {READINESS_CHECKS.map((name) => {
          const check = report?.checks.find((c) => c.name === name);
          const Icon = !check ? Loader2Icon : check.ok ? CircleCheckIcon : CircleXIcon;
          return (
            <li key={name} className="flex items-center gap-1.5 text-sm" title={check?.message}>
              <Icon
                aria-hidden
                className={cn(
                  'size-4 shrink-0',
                  !check && 'animate-spin text-muted-foreground',
                  check?.ok && 'text-success',
                  check && !check.ok && 'text-destructive',
                )}
              />
              <span>{READINESS_LABEL[name]}</span>
              <span className="sr-only">
                {!check ? 'checking' : check.ok ? 'works' : `failed: ${check.message ?? ''}`}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
