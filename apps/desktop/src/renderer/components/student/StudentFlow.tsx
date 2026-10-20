import { useState } from 'react';
import type { JoinResult, ProbeResult } from '@examguard/shared';
import { ConfirmName } from './ConfirmName';
import { FindExamScreen } from './FindExamScreen';
import { JoinForm } from './JoinForm';
import { MonitoringNotice } from './MonitoringNotice';
import { WaitingScreen } from './WaitingScreen';

type Host = Extract<ProbeResult, { ok: true }>;
type Joined = Extract<JoinResult, { ok: true }>;

type Step =
  | { name: 'find' }
  | { name: 'credentials'; host: Host }
  | { name: 'confirm'; host: Host; joined: Joined }
  | { name: 'notice'; host: Host; joined: Joined }
  | { name: 'waiting'; joined: Joined };

/** Student screens in order: find a host, ID + PIN, confirm name, notice, waiting. */
export function StudentFlow() {
  const [step, setStep] = useState<Step>({ name: 'find' });
  const toFind = () => setStep({ name: 'find' });

  switch (step.name) {
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
          onAccepted={() => setStep({ name: 'waiting', joined: step.joined })}
          onBack={() => setStep({ name: 'credentials', host: step.host })}
        />
      );
    case 'waiting':
      return <WaitingScreen name={step.joined.name} examTitle={step.joined.examTitle} />;
  }
}
