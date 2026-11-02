import { useState } from 'react';
import type { ExamState, RosterEntry } from '@examguard/shared';
import type { ExamApi } from '@/api/examApi';
import { sortedStudents } from '@/lib/rosterState';
import type { RosterView } from '@/hooks/useRoster';
import { AuditLogPanel } from './AuditLogPanel';
import { EventsPanel } from './EventsPanel';
import { RosterTable } from './RosterTable';
import { StudentDetail } from './StudentDetail';
import { TerminalLogDialog } from './TerminalLogDialog';
import { ThumbnailGrid } from './ThumbnailGrid';

type View = 'table' | 'grid';

interface Props {
  examId: string;
  api: ExamApi;
  roster: RosterView;
  /** Which per-student actions fit (M35). */
  examState: ExamState;
}

/**
 * The live dashboard (M31, M32, M33): the sortable roster or the thumbnail grid of screens, the
 * alert feed, the teacher action log (M36), and a student's detail with their timeline when a row, a
 * tile or a name in the feed is clicked.
 */
export function MonitoringBoard({ examId, api, roster, examState }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [logOf, setLogOf] = useState<RosterEntry | null>(null);
  const [view, setView] = useState<View>('table');
  const students = sortedStudents(roster);
  const selected = selectedId ? roster.students.get(selectedId) : undefined;

  return (
    <>
      <section
        aria-label="Students"
        className="flex flex-col gap-2 rounded-md border border-border p-4"
      >
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold">Students</h2>
          <span className="text-sm text-muted">
            {students.length} joined · click a row for the timeline
          </span>
          {!roster.live && <span className="text-sm text-amber-700">(reconnecting…)</span>}
          <div
            role="group"
            aria-label="View"
            className="ml-auto flex overflow-hidden rounded-md border border-border text-sm"
          >
            {(['table', 'grid'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={`px-3 py-1 ${view === v ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-background'}`}
              >
                {v === 'table' ? 'Table' : 'Screens'}
              </button>
            ))}
          </div>
        </div>
        {view === 'table' ? (
          <RosterTable
            students={students}
            selectedId={selectedId}
            onSelect={(s) => setSelectedId(s.id === selectedId ? null : s.id)}
          />
        ) : (
          <ThumbnailGrid
            api={api}
            roster={roster}
            students={students}
            selectedId={selectedId}
            onSelect={(s) => setSelectedId(s.id === selectedId ? null : s.id)}
          />
        )}
      </section>
      <EventsPanel
        examId={examId}
        api={api}
        roster={roster}
        students={students}
        onStudent={setSelectedId}
      />
      <AuditLogPanel
        examId={examId}
        api={api}
        live={examState === 'hosting' || examState === 'running'}
      />
      {selected && (
        <StudentDetail
          key={selected.id}
          examId={examId}
          api={api}
          student={selected}
          roster={roster}
          examState={examState}
          onTerminalLog={setLogOf}
          onClose={() => setSelectedId(null)}
        />
      )}
      {logOf && (
        <TerminalLogDialog
          examId={examId}
          student={logOf}
          api={api}
          onClose={() => setLogOf(null)}
        />
      )}
    </>
  );
}
