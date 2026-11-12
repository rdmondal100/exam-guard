import { useEffect, useState } from 'react';
import { CircleAlertIcon } from 'lucide-react';
import type { AppInfo, AppMode } from '@examguard/shared';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { CenteredScreen } from './components/common/CenteredScreen';
import { ConfirmProvider } from './components/common/ConfirmProvider';
import { StudentFlow } from './components/student/StudentFlow';
import { TeacherGate } from './components/teacher/TeacherGate';
import { ModeSelect } from './components/common/ModeSelect';

function Screen() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.examguard.getInfo().then(setInfo, (e: unknown) => setError(String(e)));
  }, []);

  const choose = (mode: AppMode) => {
    window.examguard.setMode(mode).then(setInfo, (e: unknown) => setError(String(e)));
  };

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
  if (!info.mode) return <ModeSelect allowed={info.allowedModes} onChoose={choose} />;
  if (info.mode === 'teacher') return <TeacherGate info={info} />;
  return <StudentFlow />;
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
