import { lazy, Suspense, useEffect, useState } from 'react';
import { CircleAlertIcon } from 'lucide-react';
import type { AppInfo } from '@examguard/shared';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { CenteredScreen } from './components/common/CenteredScreen';
import { ConfirmProvider } from './components/common/ConfirmProvider';

// One app per build (M52): the constant branch keeps the other app's screens out of the bundle.
const Root =
  __EG_APP__ === 'teacher'
    ? lazy(() =>
        import('./components/teacher/TeacherGate').then((m) => ({ default: m.TeacherGate })),
      )
    : lazy(() =>
        import('./components/student/StudentFlow').then(({ StudentFlow }) => ({
          default: function StudentRoot({ info }: { info: AppInfo }) {
            return <StudentFlow key={info.profile} />;
          },
        })),
      );

function Screen() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.examguard.getInfo().then(setInfo, (e: unknown) => setError(String(e)));
    document.title = __EG_APP__ === 'teacher' ? 'ExamGuard Teacher' : 'ExamGuard Student';
  }, []);

  if (error) {
    return (
      <CenteredScreen>
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </CenteredScreen>
    );
  }
  if (!info) return null;
  return (
    <Suspense fallback={null}>
      <Root info={info} />
    </Suspense>
  );
}

/** App-wide providers (M51): tooltips, the confirm dialog and toasts. */
export function App() {
  return (
    <TooltipProvider>
      <ConfirmProvider>
        <Screen />
        <Toaster />
      </ConfirmProvider>
    </TooltipProvider>
  );
}
