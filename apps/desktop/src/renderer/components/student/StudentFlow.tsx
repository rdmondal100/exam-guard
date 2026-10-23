import { useEffect, useState } from 'react';
import type { JoinResult, ProbeResult } from '@examguard/shared';
import { ConfirmName } from './ConfirmName';
import { FindExamScreen } from './FindExamScreen';
import { JoinForm } from './JoinForm';
import { MonitoringNotice } from './MonitoringNotice';
import { SessionScreen } from './SessionScreen';

type Host = Extract<ProbeResult, { ok: true }>;
type Joined = Extract<JoinResult, { ok: true }>;

type Step =
  | { name: 'resuming' }
  | { name: 'find' }
  | { name: 'credentials'; host: Host }
  | { name: 'confirm'; host: Host; joined: Joined }
  | { name: 'notice'; host: Host; joined: Joined }
  | { name: 'lobby'; joined: Joined };

/**
 * Student screens in order: find a host, ID + PIN, confirm name, notice, lobby. A restarted app
 * first looks for the session it left (same PC, same sign-in) and goes straight back to it.
 */
export function StudentFlow() {
  const [step, setStep] = useState<Step>({ name: 'resuming' });
  const toFind = () => setStep({ name: 'find' });

  useEffect(() => {
    let cancelled = false;
    window.examguard
      .resumeSession()
      .then((joined) => {
        if (cancelled) return;
        setStep(joined?.ok ? { name: 'lobby', joined } : { name: 'find' });
      })
      .catch(() => {
        if (!cancelled) setStep({ name: 'find' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const leave = () => {
    window.examguard.leaveSession().finally(toFind);
  };

  switch (step.name) {
    case 'resuming':
      return (
        <main className="flex min-h-screen items-center justify-center p-8">
          <p className="text-muted">Looking for your exam…</p>
        </main>
      );
    case 'find':
      return <FindExamScreen onContinue={(host) => setStep({ name: 'credentials', host })} />;
    case 'credentials':
      return (
        <JoinForm
          address={step.host.address}
          port={step.host.port}
          fingerprint={step.host.fingerprint}
          examTitle={step.host.info.examTitle}
          onJoined={(joined) => setStep({ name: 'confirm', host: step.host, joined })}
          onBack={toFind}
        />
      );
    case 'confirm':
      return (
        <ConfirmName
          name={step.joined.name}
          examTitle={step.joined.examTitle}
          onYes={() => setStep({ name: 'notice', host: step.host, joined: step.joined })}
          onNo={() => setStep({ name: 'credentials', host: step.host })}
        />
      );
    case 'notice':
      return (
        <MonitoringNotice
          onAccepted={() => setStep({ name: 'lobby', joined: step.joined })}
          onBack={() => setStep({ name: 'credentials', host: step.host })}
        />
      );
    case 'lobby':
      return (
        <SessionScreen name={step.joined.name} examTitle={step.joined.examTitle} onLeave={leave} />
      );
  }
}
