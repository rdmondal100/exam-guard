import { MAX_RUN_FLAGS_CHARS, type QuestionLanguage } from '@examguard/shared';

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
    <label className="flex items-center gap-2 text-sm font-medium">
      <span className="shrink-0">{LABEL[language]}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        maxLength={MAX_RUN_FLAGS_CHARS}
        spellCheck={false}
        placeholder={interpreted ? '(none)' : 'e.g. -lfreeglut -lopengl32 -lglu32 -lm'}
        className="min-w-0 flex-1 rounded-md border px-2 py-1 font-mono text-sm font-normal"
      />
    </label>
  );
}
