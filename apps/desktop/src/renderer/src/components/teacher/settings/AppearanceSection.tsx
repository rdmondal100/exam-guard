import { useEffect, useState } from 'react';
import { MonitorIcon, MoonIcon, SunIcon, type LucideIcon } from 'lucide-react';
import type { ThemeSource } from '@examguard/shared';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import { SettingsCard } from './SettingsCard';

const OPTIONS: { value: ThemeSource; label: string; icon: LucideIcon }[] = [
  { value: 'system', label: 'System', icon: MonitorIcon },
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon },
];

/**
 * Light, dark or follow Windows (M51). Kept per profile on this PC by main, which applies it at
 * once through `nativeTheme`; students' PCs follow Windows.
 */
export function AppearanceSection() {
  const [theme, setTheme] = useState<ThemeSource | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.examguard.getTheme().then(setTheme, () => setTheme('system'));
  }, []);

  const choose = (value: string) => {
    const next = OPTIONS.find((o) => o.value === value)?.value;
    if (!next) return;
    setTheme(next);
    setError(null);
    window.examguard.setTheme(next).catch((e: unknown) => setError(String(e)));
  };

  return (
    <SettingsCard
      title="Appearance"
      description="The colour theme of ExamGuard on this computer."
      error={error}
    >
      <RadioGroup
        aria-label="Theme"
        value={theme ?? ''}
        onValueChange={choose}
        className="grid grid-cols-3 gap-3"
      >
        {OPTIONS.map(({ value, label, icon: Icon }) => (
          <label
            key={value}
            className={cn(
              'flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm font-medium transition-colors hover:bg-accent/50',
              theme === value && 'border-primary bg-primary/5',
            )}
          >
            <RadioGroupItem value={value} />
            <Icon className="size-4 text-muted-foreground" aria-hidden />
            {label}
          </label>
        ))}
      </RadioGroup>
    </SettingsCard>
  );
}
