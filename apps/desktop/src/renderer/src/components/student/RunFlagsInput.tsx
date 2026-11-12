import { MAX_RUN_FLAGS_CHARS, type QuestionLanguage } from '@examguard/shared';
import { Input } from '@/components/ui/input';

const LABEL: Record<QuestionLanguage, string> = {
  c: 'Compiler flags',
  cpp: 'Compiler flags',
  js: 'Node flags',
  py: 'Python flags',
};

interface Props {
  language: QuestionLanguage;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}

/** The student's own flags: compiler flags for C/C++, Node or Python flags for the others. */
export function RunFlagsInput({ language, value, onChange, disabled }: Props) {
  const interpreted = language === 'js' || language === 'py';
  return (
    <label className="flex items-center gap-3 text-sm font-medium">
      <span className="shrink-0 text-muted-foreground">{LABEL[language]}</span>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        maxLength={MAX_RUN_FLAGS_CHARS}
        spellCheck={false}
        placeholder={interpreted ? '(none)' : 'e.g. -lfreeglut -lopengl32 -lglu32 -lm'}
        className="h-8 font-mono font-normal"
      />
    </label>
  );
}
