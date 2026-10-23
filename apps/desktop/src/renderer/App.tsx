import { useEffect, useState } from 'react';
import type { AppInfo, AppMode } from '@examguard/shared';
import { AgentGate } from './components/student/AgentGate';
import { StudentFlow } from './components/student/StudentFlow';
import { TeacherGate } from './components/teacher/TeacherGate';
import { ModeSelect } from './components/ModeSelect';

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Until the student reaches the Find screen, the agent gate stays out of the way (resuming).
  const [inSession, setInSession] = useState(true);

  useEffect(() => {
    window.examguard.getInfo().then(setInfo, (e: unknown) => setError(String(e)));
  }, []);

  const choose = (mode: AppMode) => {
    window.examguard.setMode(mode).then(setInfo, (e: unknown) => setError(String(e)));
  };

  if (error) return <p className="p-8 text-red-700">Something went wrong: {error}</p>;
  if (!info) return null;
  if (!info.mode) return <ModeSelect allowed={info.allowedModes} onChoose={choose} />;
  if (info.mode === 'teacher') return <TeacherGate info={info} />;
  return (
    <AgentGate bypass={inSession}>
      <StudentFlow onInSession={setInSession} />
    </AgentGate>
  );
}
