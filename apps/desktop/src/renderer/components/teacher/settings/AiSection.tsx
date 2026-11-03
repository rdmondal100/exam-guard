import { useEffect, useState } from 'react';
import type { AiKeyStatus, TeacherSettings } from '@examguard/shared';
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

function keyLabel(s: AiKeyStatus | null): string {
  if (!s) return '…';
  if (s.source === 'stored') return 'A key is saved (encrypted on this PC).';
  if (s.source === 'env') return 'No key saved; using EG_GEMINI_API_KEY from the shell (dev).';
  return 'No key is saved. AI grading needs one.';
}

/**
 * AI grading (M43): provider, model and how many answers are graded at once, plus the API key.
 * The key goes straight to main, which encrypts it; it is never shown again or sent back.
 */
export function AiSection({ api, settings, onSaved }: Props) {
  const [model, setModel] = useState(settings.ai.model);
  const [concurrency, setConcurrency] = useState(String(settings.grading.concurrency));
  const [key, setKey] = useState('');
  const [status, setStatus] = useState<AiKeyStatus | null>(null);
  const save = useAction();
  const keyAction = useAction();

  useEffect(() => {
    window.examguard.aiKeyStatus().then(setStatus, () => setStatus(null));
  }, []);

  const n = Number(concurrency);
  const valid = model.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= 16;

  const saveSettings = () =>
    void save.run(async () => {
      onSaved(
        await api.update({
          ai: { provider: 'gemini', model: model.trim() },
          grading: { concurrency: n },
        }),
      );
      return 'AI settings saved.';
    });

  const saveKey = () =>
    void keyAction.run(async () => {
      setStatus(await window.examguard.setAiKey(key.trim()));
      setKey('');
      return 'Key saved.';
    });

  const removeKey = () => {
    if (!window.confirm('Remove the saved AI key from this PC?')) return;
    void keyAction.run(async () => {
      setStatus(await window.examguard.clearAiKey());
      return 'Key removed.';
    });
  };

  return (
    <SettingsCard
      title="AI grading"
      description="Only an anonymous id and the answers are sent to the provider, never names or student IDs."
      notice={save.notice ?? keyAction.notice}
      error={save.error ?? keyAction.error}
    >
      <label className={FIELD}>
        Provider
        <select
          className="h-10 rounded-md border border-border bg-card px-3 text-sm"
          value="gemini"
          disabled
        >
          <option value="gemini">Google Gemini</option>
        </select>
      </label>
      <label className={FIELD}>
        Model
        <Input value={model} maxLength={100} onChange={(e) => setModel(e.target.value)} />
      </label>
      <label className={FIELD}>
        Answers graded at the same time (1–16)
        <Input
          type="number"
          min={1}
          max={16}
          value={concurrency}
          onChange={(e) => setConcurrency(e.target.value)}
        />
      </label>
      <Button className="self-start" disabled={save.busy || !valid} onClick={saveSettings}>
        Save AI settings
      </Button>

      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <p className="text-sm">{keyLabel(status)}</p>
        {status && !status.encryptionAvailable && (
          <p className="text-sm text-amber-800">
            Windows cannot encrypt data for this user, so a key cannot be saved here.
          </p>
        )}
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            saveKey();
          }}
        >
          <label className={`${FIELD} min-w-64 flex-1`}>
            {status?.source === 'stored' ? 'Replace the key' : 'API key'}
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </label>
          <Button type="submit" disabled={keyAction.busy || key.trim().length < 10}>
            Save key
          </Button>
          {status?.source === 'stored' && (
            <Button type="button" variant="outline" disabled={keyAction.busy} onClick={removeKey}>
              Remove key
            </Button>
          )}
        </form>
      </div>
    </SettingsCard>
  );
}
