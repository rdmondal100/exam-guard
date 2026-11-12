import { GraduationCapIcon, MonitorCheckIcon, type LucideIcon } from 'lucide-react';
import type { AppMode } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { CenteredScreen } from './CenteredScreen';

const OPTIONS: Record<AppMode, { title: string; text: string; icon: LucideIcon }> = {
  teacher: {
    title: 'Teacher',
    text: 'Host the exam on this PC, monitor students live and grade with AI.',
    icon: MonitorCheckIcon,
  },
  student: {
    title: 'Student',
    text: 'Join an exam from your teacher and take it in a fullscreen window.',
    icon: GraduationCapIcon,
  },
};

interface Props {
  allowed: AppMode[];
  onChoose: (mode: AppMode) => void;
}

export function ModeSelect({ allowed, onChoose }: Props) {
  return (
    <CenteredScreen width="xl">
      <header className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Welcome to ExamGuard AI</h1>
        <p className="mt-2 text-muted-foreground">How will you use this computer?</p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2">
        {allowed.map((mode) => {
          const { title, text, icon: Icon } = OPTIONS[mode];
          return (
            <Card key={mode}>
              <CardHeader>
                <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-5" aria-hidden />
                </div>
                <CardTitle>{title} mode</CardTitle>
                <CardDescription>{text}</CardDescription>
              </CardHeader>
              <CardContent className="flex-1" />
              <CardFooter>
                <Button className="w-full" onClick={() => onChoose(mode)}>
                  Use {title} mode
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </CenteredScreen>
  );
}
