import { useSettings } from '@/hooks/useSettings';
import { ErrorAlert } from '../../components/common/ErrorAlert';
import { PageHeader } from '../../components/common/PageHeader';
import { AiSection } from '../../components/teacher/settings/AiSection';
import { AppearanceSection } from '../../components/teacher/settings/AppearanceSection';
import { DataFolderSection } from '../../components/teacher/settings/DataFolderSection';
import { DefaultsSection } from '../../components/teacher/settings/DefaultsSection';
import { PasswordSection } from '../../components/teacher/settings/PasswordSection';
import { RetentionSection } from '../../components/teacher/settings/RetentionSection';
import { RunLimitsSection } from '../../components/teacher/settings/RunLimitsSection';
import { ServerSection } from '../../components/teacher/settings/ServerSection';

/**
 * Settings (M43): password, AI grading and key, new-exam defaults, run limits, the student port,
 * the certificate and a manual backup (M43); screenshot retention and the data folder (M44); the
 * colour theme (M51). Each section saves on its own.
 */
export function SettingsPage() {
  const { api, settings, error, set } = useSettings();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title="Settings" description="Each section saves on its own." />
      {error && <ErrorAlert>{error}</ErrorAlert>}
      <AppearanceSection />
      {api && <PasswordSection api={api} />}
      {api && settings && (
        <>
          <AiSection api={api} settings={settings} onSaved={set} />
          <DefaultsSection api={api} settings={settings} onSaved={set} />
          <RunLimitsSection api={api} settings={settings} onSaved={set} />
          <ServerSection api={api} settings={settings} onSaved={set} />
          <RetentionSection api={api} settings={settings} onSaved={set} />
        </>
      )}
      <DataFolderSection />
    </div>
  );
}
