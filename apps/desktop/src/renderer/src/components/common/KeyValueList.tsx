import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface KeyValue {
  label: string;
  value: ReactNode;
}

interface Props {
  items: KeyValue[];
  className?: string;
  /** Labels and values side by side (default) or stacked in a grid of tiles. */
  layout?: 'rows' | 'tiles';
}

/** A description list (M51): PIN / address / joined, student details, receipt lines. */
export function KeyValueList({ items, className, layout = 'rows' }: Props) {
  if (layout === 'tiles') {
    return (
      <dl className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5', className)}>
        {items.map((item) => (
          <div key={item.label} className="flex flex-col gap-1 rounded-lg border bg-muted/40 p-3">
            <dt className="text-xs font-medium text-muted-foreground">{item.label}</dt>
            <dd className="text-sm font-semibold break-all">{item.value}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <dl className={cn('grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm', className)}>
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="font-medium break-all">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
