import { useState } from 'react';
import type { AppInfo, ServerStatus } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import { ClassListsPage } from './ClassListsPage';
import { ExamsPage } from './ExamsPage';
import { ServerRestartBanner } from '../ServerRestartBanner';
import { ServerStatusChip } from '../ServerStatusChip';

const NAV = ['Home', 'Class lists', 'Exams', 'Settings'] as const;
type Page = (typeof NAV)[number];
const AVAILABLE: readonly Page[] = ['Home', 'Class lists', 'Exams'];

interface Props {
  info: AppInfo;
  serverStatus: ServerStatus | null;
  onLogout: () => void;
}

/** Shell behind the login gate: nav plus the current page. Settings comes later. */
export function TeacherShell({ info, serverStatus, onLogout }: Props) {
  const [page, setPage] = useState<Page>('Home');
  return (
    <div className="flex min-h-screen">
      <nav
        aria-label="Teacher"
        className="flex w-56 flex-col gap-1 border-r border-border bg-card p-4"
      >
        <span className="mb-4 text-lg font-semibold">ExamGuard AI</span>
        {NAV.map((label) => (
          <button
            key={label}
            disabled={!AVAILABLE.includes(label)}
            onClick={() => setPage(label)}
            aria-current={label === page ? 'page' : undefined}
            className="rounded-md px-3 py-2 text-left text-sm disabled:opacity-50 aria-[current=page]:bg-background aria-[current=page]:font-medium"
          >
            {label}
          </button>
        ))}
      </nav>
      <main className="flex-1 p-8">
        {page === 'Class lists' || page === 'Exams' ? (
          <>
            <div className="mb-4 flex justify-end">
              <Button variant="outline" onClick={onLogout}>
                Log out
              </Button>
            </div>
            {page === 'Exams' ? <ExamsPage /> : <ClassListsPage />}
          </>
        ) : (
          <>
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
            <p className="mt-8 text-muted">No exams yet. Exams come next.</p>
          </>
        )}
      </main>
    </div>
  );
}
