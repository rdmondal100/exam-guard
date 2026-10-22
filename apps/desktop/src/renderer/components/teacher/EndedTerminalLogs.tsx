import { useState } from 'react';
import type { RosterEntry } from '@examguard/shared';
import type { ExamApi } from '@/lib/examApi';
import { sortedStudents } from '@/lib/rosterState';
import { useRoster } from '@/lib/useRoster';
import { RosterList } from './RosterList';
import { TerminalLogDialog } from './TerminalLogDialog';

/** After the exam: the students who joined, each with their terminal log. */
export function EndedTerminalLogs({ examId, api }: { examId: string; api: ExamApi }) {
  const roster = useRoster(examId);
  const [logOf, setLogOf] = useState<RosterEntry | null>(null);
  return (
    <section aria-label="Terminal logs" className="flex flex-col gap-2 rounded-md border p-4">
      <h2 className="font-semibold">Terminal logs</h2>
      <RosterList students={sortedStudents(roster)} onTerminalLog={setLogOf} />
      {logOf && (
        <TerminalLogDialog
          examId={examId}
          student={logOf}
          api={api}
          onClose={() => setLogOf(null)}
        />
      )}
    </section>
  );
}
