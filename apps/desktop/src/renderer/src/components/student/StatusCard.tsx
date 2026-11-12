import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { CenteredScreen } from '../common/CenteredScreen';

const TONE = {
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success/12 text-success',
  warning: 'bg-warning/15 text-warning',
  destructive: 'bg-destructive/12 text-destructive',
} as const;

interface Props {
  icon: LucideIcon;
  tone: keyof typeof TONE;
  title: string;
  name: string;
  examTitle: string;
  children: ReactNode;
  width?: 'md' | 'lg';
}

/** One card for the student's state screens (M51): lobby, restoring, receipt, ended, closed. */
export function StatusCard({ icon: Icon, tone, title, name, examTitle, children, width }: Props) {
  return (
    <CenteredScreen width={width}>
      <Card>
        <CardHeader className="items-center">
          <div className="flex items-center gap-4">
            <div
              className={cn(
                'flex size-12 shrink-0 items-center justify-center rounded-full',
                TONE[tone],
              )}
            >
              <Icon className="size-6" aria-hidden />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <CardTitle className="text-2xl leading-tight">{title}</CardTitle>
              <CardDescription>
                <span className="font-medium text-foreground">{name}</span> · {examTitle}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">{children}</CardContent>
      </Card>
    </CenteredScreen>
  );
}
