import { useSettings } from '@/hooks/useSettings';
import { AiSection } from '../../components/teacher/settings/AiSection';
import { DataFolderSection } from '../../components/teacher/settings/DataFolderSection';
import { DefaultsSection } from '../../components/teacher/settings/DefaultsSection';
import { PasswordSection } from '../../components/teacher/settings/PasswordSection';
import { RetentionSection } from '../../components/teacher/settings/RetentionSection';
import { RunLimitsSection } from '../../components/teacher/settings/RunLimitsSection';
import { ServerSection } from '../../components/teacher/settings/ServerSection';

/**
 * Settings (M43): password, AI grading and key, new-exam defaults, run limits, the student port,
 * the certificate and a manual backup (M43); screenshot retention and the data folder (M44). Each
 * section saves on its own.
 */
export function SettingsPage() {
  const { api, settings, error, set } = useSettings();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-semibold">Settings</h1>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
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
