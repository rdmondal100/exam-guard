import { useEffect, useState } from 'react';
import type { CertInfo, TeacherSettings } from '@examguard/shared';
import type { SettingsApi } from '@/api/settingsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingsCard } from './SettingsCard';
import { FIELD } from './styles';
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

  const regenerate = () => {
    const ok = window.confirm(
      'Make a new certificate? Students compare a new 4-character code the next time they join.',
    );
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
        notice={portAction.notice ?? certAction.notice}
        error={portAction.error ?? certAction.error}
      >
        <label className={FIELD}>
          Student port (1024–65535)
          <Input
            type="number"
            min={1024}
            max={65535}
            value={port}
            onChange={(e) => setPort(e.target.value)}
          />
        </label>
        <Button className="self-start" disabled={portAction.busy || !valid} onClick={savePort}>
          Save port
        </Button>
        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3 text-sm">
          <span>
            Certificate code:{' '}
            <span className="font-mono text-base font-semibold">{cert?.fpCode ?? '…'}</span>
          </span>
          <Button variant="outline" disabled={certAction.busy} onClick={regenerate}>
            Make a new certificate
          </Button>
        </div>
      </SettingsCard>
      <SettingsCard
        title="Backup"
        description="Copies the database and the screenshots into the backups folder. One is also taken before each finalize."
        notice={backupAction.notice}
        error={backupAction.error}
      >
        <Button className="self-start" disabled={backupAction.busy} onClick={backup}>
          Back up now
        </Button>
      </SettingsCard>
    </>
  );
}
