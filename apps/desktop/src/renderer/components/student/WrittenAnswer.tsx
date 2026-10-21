interface Props {
  value: string;
  onChange: (value: string) => void;
}

/** Plain text box for written answers. */
export function WrittenAnswer({ value, onChange }: Props) {
  return (
    <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
      Your answer
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-48 flex-1 resize-none rounded-md border p-3 font-mono text-sm font-normal"
        spellCheck={false}
      />
    </label>
  );
}
