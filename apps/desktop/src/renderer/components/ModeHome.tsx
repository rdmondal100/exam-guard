import type { AppInfo } from '@examguard/shared';
import { useServerStatus } from '../lib/useServerStatus';
import { ServerRestartBanner } from './ServerRestartBanner';
import { ServerStatusChip } from './ServerStatusChip';

/** Placeholder until the real Teacher (M05) and Student screens exist. */
export function ModeHome({ info }: { info: AppInfo }) {
  const label = info.mode === 'teacher' ? 'Teacher' : 'Student';
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center p-8">
      <h1 className="text-3xl font-semibold">{label} mode</h1>
      <p className="mt-2 text-muted">
        Profile: {info.profile} · Install type: {info.installType}
      </p>
      {info.mode === 'teacher' && <TeacherServerStatus />}
    </main>
  );
}

function TeacherServerStatus() {
  const status = useServerStatus();
  if (!status) return null;
  return (
    <>
      <div className="mt-4">
        <ServerStatusChip status={status} />
      </div>
      <ServerRestartBanner status={status} />
    </>
  );
}
