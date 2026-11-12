import { useState } from 'react';
import { ShieldCheckIcon } from 'lucide-react';
import type { DiscoveredHost, ProbeResult } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import type { HostAddress } from '@/lib/hostAddress';
import { useDiscovery } from '@/hooks/useDiscovery';
import { CenteredScreen } from '../../components/common/CenteredScreen';
import { ErrorAlert } from '../../components/common/ErrorAlert';
import { HostList } from '../../components/student/HostList';
import { ManualIpForm } from '../../components/student/ManualIpForm';

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
    <CenteredScreen width="lg">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Find your exam</CardTitle>
          <CardDescription>
            Pick your teacher&apos;s exam from the list, or enter its address.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <HostList hosts={hosts} busy={busy} onPick={pick} />
          <Separator />
          <ManualIpForm busy={busy} onSubmit={(target) => void probe(target)} />
          {error && <ErrorAlert>{error}</ErrorAlert>}
        </CardContent>
      </Card>
      {found && (
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle>{found.host.info.examTitle}</CardTitle>
            <CardDescription>
              {found.host.address}:{found.host.port}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <p className="flex items-center gap-2 text-sm">
              <ShieldCheckIcon className="size-4 text-primary" aria-hidden />
              Security code:{' '}
              <span className="font-mono text-xl font-semibold tracking-wider">
                {found.host.info.fpCode}
              </span>
            </p>
            <p className="text-sm text-muted-foreground">
              {found.viaList
                ? 'This computer matches what the teacher announced.'
                : 'Check that this code matches the one on the teacher screen before you continue.'}
            </p>
          </CardContent>
          <CardFooter>
            <Button onClick={() => onContinue(found.host)}>Continue</Button>
          </CardFooter>
        </Card>
      )}
    </CenteredScreen>
  );
}
