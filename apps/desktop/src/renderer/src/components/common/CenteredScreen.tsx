import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { AppMark } from './AppMark';

interface Props {
  children: ReactNode;
  /** `md` for one card (login, join); `lg`/`xl` for wider content. */
  width?: 'md' | 'lg' | 'xl';
  /** Hide the app mark above the content. */
  bare?: boolean;
  className?: string;
}

const WIDTH = { md: 'max-w-md', lg: 'max-w-xl', xl: 'max-w-3xl' } as const;

/** A full-window screen with its content centred on a soft background (M51). */
export function CenteredScreen({ children, width = 'md', bare = false, className }: Props) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <div className={cn('flex w-full flex-col gap-6', WIDTH[width], className)}>
        {!bare && <AppMark withName className="justify-center" />}
        {children}
      </div>
    </main>
  );
}
