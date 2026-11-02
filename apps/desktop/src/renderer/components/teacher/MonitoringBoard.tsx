import { useState } from 'react';
import type { RosterEntry } from '@examguard/shared';
import type { ExamApi } from '@/api/examApi';
import { sortedStudents } from '@/lib/rosterState';
import type { RosterView } from '@/hooks/useRoster';
import { EventsPanel } from './EventsPanel';
import { RosterTable } from './RosterTable';
import { StudentDetail } from './StudentDetail';
import { TerminalLogDialog } from './TerminalLogDialog';

interface Props {
  examId: string;
  api: ExamApi;
  roster: RosterView;
  /** The exam is running: a locked student can be unlocked. */
  running: boolean;
}

/**
 * The live dashboard (M31, M32): the sortable roster, the alert feed, and a student's detail with
 * their timeline when a row or a name in the feed is clicked.
 */
export function MonitoringBoard({ examId, api, roster, running }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [logOf, setLogOf] = useState<RosterEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const students = sortedStudents(roster);
  const selected = selectedId ? roster.students.get(selectedId) : undefined;

  const unlock = (s: RosterEntry) =>
    void api.unlock(examId, s.id).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
    });

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
        </div>
        {error && (
          <p role="alert" className="text-red-700">
            {error}
          </p>
        )}
        <RosterTable
          students={students}
          selectedId={selectedId}
          onSelect={(s) => setSelectedId(s.id === selectedId ? null : s.id)}
        />
      </section>
      <EventsPanel
        examId={examId}
        api={api}
        roster={roster}
        students={students}
        onStudent={setSelectedId}
      />
      {selected && (
        <StudentDetail
          key={selected.id}
          examId={examId}
          api={api}
          student={selected}
          roster={roster}
          {...(running ? { onUnlock: unlock } : {})}
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
