import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const alertVariants = cva(
  'relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-lg border px-4 py-3 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current',
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground',
        destructive:
          'border-destructive/30 bg-destructive/8 text-destructive *:data-[slot=alert-description]:text-destructive/90',
        warning:
          'border-warning/30 bg-warning/10 text-warning *:data-[slot=alert-description]:text-foreground/85',
        success:
          'border-success/30 bg-success/10 text-success *:data-[slot=alert-description]:text-foreground/85',
        info: 'border-info/30 bg-info/8 text-info *:data-[slot=alert-description]:text-foreground/85',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export type AlertTone = NonNullable<VariantProps<typeof alertVariants>['variant']>;

/** Defaults to `role="alert"`; pass `role="status"` for calm, non-urgent notices. */
export function Alert({
  className,
  variant,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

export function AlertTitle({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      data-slot="alert-title"
      className={cn('col-start-2 min-h-4 font-medium tracking-tight', className)}
      {...props}
    />
  );
}

export function AlertDescription({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        'col-start-2 grid justify-items-start gap-1 text-sm text-muted-foreground [&_p]:leading-relaxed',
        className,
      )}
      {...props}
    />
  );
}
