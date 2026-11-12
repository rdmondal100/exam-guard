import { useEffect, useState } from 'react';
import { FolderOpenIcon, FolderInputIcon, Undo2Icon } from 'lucide-react';
import type { DataFolderInfo } from '@examguard/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/hooks/useConfirm';
import { Spinner } from '../../common/Spinner';
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
  const confirm = useConfirm();

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
    const ok = await confirm({
      title: `Move the database, screenshots, exam files, exports and backups to ${picked}?`,
      description:
        'The exam server stops while the data is copied and checked, and you sign in again afterwards.',
      confirmLabel: 'Move data',
    });
    if (ok) move(picked);
  };

  const moveBack = async () => {
    const ok = await confirm({
      title: 'Move the data back to the default folder?',
      description: 'You sign in again afterwards.',
      confirmLabel: 'Move back',
    });
    if (ok) move(null);
  };

  return (
    <SettingsCard
      title="Data folder"
      description="The database, screenshots, exam files, exports, backups and logs. Moving is not possible while an exam is hosting or running."
      error={action.error}
      footer={
        <>
          <Button variant="outline" onClick={() => void window.examguard.openDataFolder()}>
            <FolderOpenIcon />
            Open folder
          </Button>
          <Button disabled={action.busy} onClick={() => void moveElsewhere()}>
            {action.busy ? <Spinner /> : <FolderInputIcon />}
            {action.busy ? 'Moving…' : 'Move…'}
          </Button>
          {info && !info.isDefault && (
            <Button variant="outline" disabled={action.busy} onClick={() => void moveBack()}>
              <Undo2Icon />
              Move back to default
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
        <code className="font-mono text-sm break-all">{info?.path ?? '…'}</code>
        {info?.isDefault && <Badge variant="neutral">default</Badge>}
      </div>
    </SettingsCard>
  );
}
