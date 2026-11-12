import { CircleAlertIcon } from 'lucide-react';
import type { AppInfo } from '@examguard/shared';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useAuth } from '@/hooks/useAuth';
import { useServerStatus } from '@/hooks/useServerStatus';
import { CenteredScreen } from '../common/CenteredScreen';
import { LoadingLine } from '../common/Spinner';
import { LoginScreen } from '../../pages/auth/LoginScreen';
import { SetupScreen } from '../../pages/auth/SetupScreen';
import { TeacherShell } from './TeacherShell';

/** Teacher mode entry: setup → login → shell. Nothing teacher-facing renders before login. */
export function TeacherGate({ info }: { info: AppInfo }) {
  const serverStatus = useServerStatus();
  const { view, api, loggedIn, logout } = useAuth(serverStatus);

  if (view.kind === 'error') {
    return (
      <CenteredScreen>
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Could not reach the exam server</AlertTitle>
          <AlertDescription>{view.message}</AlertDescription>
        </Alert>
      </CenteredScreen>
    );
  }
  if (view.kind === 'loading' || !api) {
    return (
      <CenteredScreen>
        <LoadingLine className="justify-center">Starting the exam server…</LoadingLine>
      </CenteredScreen>
    );
  }
  if (view.kind === 'setup') return <SetupScreen api={api} onDone={loggedIn} />;
  if (view.kind === 'login') return <LoginScreen api={api} onDone={loggedIn} />;
  return <TeacherShell info={info} serverStatus={serverStatus} onLogout={() => void logout()} />;
}
