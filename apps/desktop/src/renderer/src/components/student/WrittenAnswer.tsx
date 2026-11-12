import { Textarea } from '@/components/ui/textarea';

interface Props {
  value: string;
  onChange: (value: string) => void;
}

/** Plain text box for written answers. */
export function WrittenAnswer({ value, onChange }: Props) {
  return (
    <label className="flex flex-1 flex-col gap-2 text-sm font-medium">
      Your answer
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-48 flex-1 resize-none p-3 font-mono font-normal"
        spellCheck={false}
      />
    </label>
  );
}
