import { FileTextIcon, ServerIcon } from 'lucide-react';
import type { AppInfo, ServerStatus } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/common/EmptyState';
import { KeyValueList } from '@/components/common/KeyValueList';
import { PageHeader } from '@/components/common/PageHeader';
import { ServerRestartBanner } from '@/components/common/ServerRestartBanner';
import { ServerStatusChip } from '@/components/common/ServerStatusChip';

interface Props {
  info: AppInfo;
  serverStatus: ServerStatus | null;
  onOpenExams: () => void;
}

/** Teacher home (M51): this PC's profile and the exam server's state, and the way to the exams. */
export function HomePage({ info, serverStatus, onOpenExams }: Props) {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader title="Teacher home" description="This PC hosts the exam for the lab." />
      {serverStatus && <ServerRestartBanner status={serverStatus} />}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ServerIcon className="size-4 text-muted-foreground" aria-hidden />
              Exam server
            </CardTitle>
            <CardDescription>Runs on this PC while ExamGuard is open.</CardDescription>
          </CardHeader>
          <CardContent>
            {serverStatus ? (
              <ServerStatusChip status={serverStatus} />
            ) : (
              <p className="text-sm text-muted-foreground">Checking…</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>This computer</CardTitle>
            <CardDescription>The profile and install type in use.</CardDescription>
          </CardHeader>
          <CardContent>
            <KeyValueList
              items={[
                { label: 'Profile', value: info.profile },
                { label: 'Install type', value: info.installType },
              ]}
            />
          </CardContent>
        </Card>
      </div>
      <EmptyState
        icon={FileTextIcon}
        title="Exams live on the Exams page"
        description="Create an exam, add questions, then host it for your students."
        action={
          <Button variant="outline" onClick={onOpenExams}>
            Go to exams
          </Button>
        }
      />
    </div>
  );
}
