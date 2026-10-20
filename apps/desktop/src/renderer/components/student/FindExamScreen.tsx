import { useState } from 'react';
import type { DiscoveredHost, ProbeResult } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import type { HostAddress } from '@/lib/hostAddress';
import { useDiscovery } from '@/lib/useDiscovery';
import { HostList } from './HostList';
import { ManualIpForm } from './ManualIpForm';

type Found = Extract<ProbeResult, { ok: true }>;

/** Student "Find exam" screen: mDNS list plus manual IP. Continue hands the pinned host on. */
export function FindExamScreen({ onContinue }: { onContinue: (host: Found) => void }) {
  const hosts = useDiscovery();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<{ host: Found; viaList: boolean } | null>(null);

  const probe = async (target: HostAddress, expectedFingerprint?: string) => {
    setBusy(true);
    setError(null);
    setFound(null);
    try {
      const result = await window.examguard.probeHost({ ...target, expectedFingerprint });
      if (result.ok) setFound({ host: result, viaList: expectedFingerprint !== undefined });
      else setError(result.message);
    } catch {
      setError('Something went wrong while contacting that computer.');
    } finally {
      setBusy(false);
    }
  };

  const pick = (host: DiscoveredHost) =>
    probe({ address: host.address, port: host.port }, host.fingerprint);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 p-8">
      <h1 className="text-3xl font-semibold">Find your exam</h1>
      <HostList hosts={hosts} busy={busy} onPick={pick} />
      <ManualIpForm busy={busy} onSubmit={(target) => void probe(target)} />
      {error && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-800">
          {error}
        </p>
      )}
      {found && (
        <section className="space-y-2 rounded-md border border-border p-4">
          <p className="font-medium">{found.host.info.examTitle}</p>
          <p className="text-sm text-muted">
            {found.host.address}:{found.host.port}
          </p>
          <p>
            Security code:{' '}
            <span className="font-mono text-xl font-semibold">{found.host.info.fpCode}</span>
          </p>
          <p className="text-sm text-muted">
            {found.viaList
              ? 'This computer matches what the teacher announced.'
              : 'Check that this code matches the one on the teacher screen before you continue.'}
          </p>
          <Button onClick={() => onContinue(found.host)}>Continue</Button>
        </section>
      )}
    </main>
  );
}
