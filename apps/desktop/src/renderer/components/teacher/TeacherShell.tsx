import type { AppInfo, ServerStatus } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import { ServerRestartBanner } from '../ServerRestartBanner';
import { ServerStatusChip } from '../ServerStatusChip';

const NAV = ['Home', 'Class lists', 'Exams', 'Settings'];

interface Props {
  info: AppInfo;
  serverStatus: ServerStatus | null;
  onLogout: () => void;
}

/** Empty home shell behind the login gate. Real pages arrive with M06 onwards. */
export function TeacherShell({ info, serverStatus, onLogout }: Props) {
  return (
    <div className="flex min-h-screen">
      <nav
        aria-label="Teacher"
        className="flex w-56 flex-col gap-1 border-r border-border bg-card p-4"
      >
        <span className="mb-4 text-lg font-semibold">ExamGuard AI</span>
        {NAV.map((label, i) => (
          <button
            key={label}
            disabled={i > 0}
            aria-current={i === 0 ? 'page' : undefined}
            className="rounded-md px-3 py-2 text-left text-sm disabled:opacity-50 aria-[current=page]:bg-background aria-[current=page]:font-medium"
          >
            {label}
          </button>
        ))}
      </nav>
      <main className="flex-1 p-8">
        <header className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold">Teacher home</h1>
          <Button variant="outline" onClick={onLogout}>
            Log out
          </Button>
        </header>
        <p className="mt-2 text-muted">
          Profile: {info.profile} · Install type: {info.installType}
        </p>
        {serverStatus && (
          <>
            <div className="mt-4">
              <ServerStatusChip status={serverStatus} />
            </div>
            <ServerRestartBanner status={serverStatus} />
          </>
        )}
        <p className="mt-8 text-muted">No exams yet. Class lists and exams come next.</p>
      </main>
    </div>
  );
}
