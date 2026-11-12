import { useEffect, useState } from 'react';
import { DatabaseBackupIcon, RefreshCwIcon } from 'lucide-react';
import type { CertInfo, TeacherSettings } from '@examguard/shared';
import type { SettingsApi } from '@/api/settingsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { useConfirm } from '@/hooks/useConfirm';
import { FormField } from '../../common/FormField';
import { Spinner } from '../../common/Spinner';
import { SettingsCard } from './SettingsCard';
import { useAction } from './useAction';

interface Props {
  api: SettingsApi;
  settings: TeacherSettings;
  onSaved: (settings: TeacherSettings) => void;
}

/**
 * The student port, the TLS certificate students pin, and a manual backup (M43). A new
 * certificate is refused while an exam is hosted, since joined students trust the old one.
 */
export function ServerSection({ api, settings, onSaved }: Props) {
  const [port, setPort] = useState(String(settings.server.studentPort));
  const [cert, setCert] = useState<CertInfo | null>(null);
  const portAction = useAction();
  const certAction = useAction();
  const backupAction = useAction();
  const confirm = useConfirm();
  const n = Number(port);
  const valid = Number.isInteger(n) && n >= 1024 && n <= 65535;

  useEffect(() => {
    api.cert().then(setCert, () => setCert(null));
  }, [api]);

  const savePort = () =>
    void portAction.run(async () => {
      onSaved(await api.update({ server: { studentPort: n } }));
      return 'Port saved. It is used the next time you host an exam.';
    });

  const regenerate = async () => {
    const ok = await confirm({
      title: 'Make a new certificate?',
      description: 'Students compare a new 4-character code the next time they join.',
      confirmLabel: 'Make new certificate',
    });
    if (!ok) return;
    void certAction.run(async () => {
      setCert(await api.regenerateCert());
      return 'New certificate made.';
    });
  };

  const backup = () =>
    void backupAction.run(async () => {
      const { backup: folder } = await api.backup();
      return `Backup saved in backups\\${folder}.`;
    });

  return (
    <>
      <SettingsCard
        title="Network"
        description="Students on the lab network connect to this port. With manual IP they type it after the address (for example 192.168.1.20:47820)."
        error={portAction.error ?? certAction.error}
      >
        <div className="flex flex-wrap items-end gap-2">
          <FormField label="Student port (1024–65535)" className="w-56">
            <Input
              type="number"
              min={1024}
              max={65535}
              value={port}
              onChange={(e) => setPort(e.target.value)}
            />
          </FormField>
          <Button disabled={portAction.busy || !valid} onClick={savePort}>
            Save port
          </Button>
        </div>
        <Separator />
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span>
            Certificate code:{' '}
            <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-base font-semibold tracking-wider">
              {cert?.fpCode ?? '…'}
            </span>
          </span>
          <Button variant="outline" disabled={certAction.busy} onClick={() => void regenerate()}>
            <RefreshCwIcon />
            Make a new certificate
          </Button>
        </div>
      </SettingsCard>
      <SettingsCard
        title="Backup"
        description="Copies the database and the screenshots into the backups folder. One is also taken before each finalize."
        error={backupAction.error}
        footer={
          <Button disabled={backupAction.busy} onClick={backup}>
            {backupAction.busy ? <Spinner /> : <DatabaseBackupIcon />}
            Back up now
          </Button>
        }
      >
        <p className="text-sm text-muted-foreground">
          Backups are kept in the data folder under <code className="font-mono">backups</code>.
        </p>
      </SettingsCard>
    </>
  );
}
