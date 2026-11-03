import { useEffect, useState } from 'react';
import type { DataFolderInfo } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import { SettingsCard } from './SettingsCard';
import { useAction } from './useAction';

/**
 * Where the data lives (M44): open it, move it to another folder or drive, or move it back to the
 * profile folder. Main copies, verifies and switches with the server stopped, so the teacher signs
 * in again afterwards; it is refused while an exam is hosting or running or grading is busy.
 */
export function DataFolderSection() {
  const [info, setInfo] = useState<DataFolderInfo | null>(null);
  const action = useAction();

  useEffect(() => {
    window.examguard.dataFolderInfo().then(setInfo, () => setInfo(null));
  }, []);

  const move = (path: string | null) =>
    void action.run(async () => {
      const result = await window.examguard.moveDataFolder(path);
      if (!result.ok) throw new Error(result.message);
      setInfo(await window.examguard.dataFolderInfo());
      return `Moved to ${result.path}.`;
    });

  const moveElsewhere = async () => {
    const picked = await window.examguard.chooseDataFolder();
    if (!picked) return;
    const ok = window.confirm(
      `Move the database, screenshots, exam files, exports and backups to ${picked}?\n\nThe exam server stops while the data is copied and checked, and you sign in again afterwards.`,
    );
    if (ok) move(picked);
  };

  const moveBack = () => {
    const ok = window.confirm(
      'Move the data back to the default folder? You sign in again afterwards.',
    );
    if (ok) move(null);
  };

  return (
    <SettingsCard
      title="Data folder"
      description="The database, screenshots, exam files, exports, backups and logs. Moving is not possible while an exam is hosting or running."
      notice={action.notice}
      error={action.error}
    >
      <p className="break-all font-mono text-sm">
        {info?.path ?? '…'}
        {info?.isDefault && <span className="ml-2 font-sans text-muted">(default)</span>}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void window.examguard.openDataFolder()}>
          Open folder
        </Button>
        <Button disabled={action.busy} onClick={() => void moveElsewhere()}>
          {action.busy ? 'Moving…' : 'Move…'}
        </Button>
        {info && !info.isDefault && (
          <Button variant="outline" disabled={action.busy} onClick={moveBack}>
            Move back to default
          </Button>
        )}
      </div>
    </SettingsCard>
  );
}
