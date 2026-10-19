import type { AppInfo } from '@examguard/shared';
import { useAuth } from '@/lib/useAuth';
import { useServerStatus } from '@/lib/useServerStatus';
import { LoginScreen } from '../auth/LoginScreen';
import { SetupScreen } from '../auth/SetupScreen';
import { TeacherShell } from './TeacherShell';

/** Teacher mode entry: setup → login → shell. Nothing teacher-facing renders before login. */
export function TeacherGate({ info }: { info: AppInfo }) {
  const serverStatus = useServerStatus();
  const { view, api, loggedIn, logout } = useAuth(serverStatus);

  if (view.kind === 'error') {
    return <p className="p-8 text-red-700">Could not reach the exam server: {view.message}</p>;
  }
  if (view.kind === 'loading' || !api) {
    return <p className="p-8 text-muted">Starting the exam server…</p>;
  }
  if (view.kind === 'setup') return <SetupScreen api={api} onDone={loggedIn} />;
  if (view.kind === 'login') return <LoginScreen api={api} onDone={loggedIn} />;
  return <TeacherShell info={info} serverStatus={serverStatus} onLogout={() => void logout()} />;
}
