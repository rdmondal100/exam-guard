import { useState } from 'react';
import { LayoutGridIcon, TableIcon } from 'lucide-react';
import type { ExamState, RosterEntry } from '@examguard/shared';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ExamApi } from '@/api/examApi';
import { sortedStudents } from '@/lib/rosterState';
import type { RosterView } from '@/hooks/useRoster';
import { AuditLogPanel } from './AuditLogPanel';
import { EventsPanel } from './EventsPanel';
import { RosterTable } from './RosterTable';
import { StudentDetail } from './StudentDetail';
import { TerminalLogDialog } from './TerminalLogDialog';
import { StudentAnswersDialog } from './StudentAnswersDialog';
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
 * tile or a name in the feed is clicked. Only the chosen view (table or screens) is mounted, as
 * before, so the screen stream runs only while it is shown.
 */
export function MonitoringBoard({ examId, api, roster, examState }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [logOf, setLogOf] = useState<RosterEntry | null>(null);
  const [answersOf, setAnswersOf] = useState<RosterEntry | null>(null);
  const [view, setView] = useState<View>('table');
  const students = sortedStudents(roster);
  const selected = selectedId ? roster.students.get(selectedId) : undefined;
  const toggle = (s: RosterEntry) => setSelectedId(s.id === selectedId ? null : s.id);

  return (
    <div className="flex flex-col gap-6">
      <Card aria-label="Students">
        <Tabs value={view} onValueChange={(v) => setView(v as View)} className="gap-6">
          <CardHeader>
            <CardTitle className="text-xl">Students</CardTitle>
            <CardDescription>
              {students.length} joined · click a row for the timeline
              {!roster.live && <span className="ml-2 text-warning">(reconnecting…)</span>}
            </CardDescription>
            <CardAction>
              <TabsList aria-label="View">
                <TabsTrigger value="table">
                  <TableIcon />
                  Table
                </TabsTrigger>
                <TabsTrigger value="grid">
                  <LayoutGridIcon />
                  Screens
                </TabsTrigger>
              </TabsList>
            </CardAction>
          </CardHeader>
          <CardContent>
            <TabsContent value="table">
              <RosterTable students={students} selectedId={selectedId} onSelect={toggle} />
            </TabsContent>
            <TabsContent value="grid">
              <ThumbnailGrid
                api={api}
                roster={roster}
                students={students}
                selectedId={selectedId}
                onSelect={toggle}
              />
            </TabsContent>
          </CardContent>
        </Tabs>
      </Card>
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
          onAnswers={setAnswersOf}
          onClose={() => setSelectedId(null)}
        />
      )}
      {answersOf && (
        <StudentAnswersDialog
          examId={examId}
          student={answersOf}
          api={api}
          examRunning={examState === 'running'}
          onClose={() => setAnswersOf(null)}
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
    </div>
  );
}
