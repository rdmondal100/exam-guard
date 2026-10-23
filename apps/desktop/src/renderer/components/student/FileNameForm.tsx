import { useState, type FormEvent } from 'react';

interface Props {
  label: string;
  initial?: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

/** A name box in the file list. Electron has no `prompt()`, so new and renamed files ask here. */
export function FileNameForm({ label, initial = '', onSubmit, onCancel }: Props) {
  const [name, setName] = useState(initial);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim() !== '') onSubmit(name.trim());
  };
  return (
    <form onSubmit={submit} className="flex items-center gap-1 p-1">
      <input
        autoFocus
        aria-label={label}
        placeholder={label}
        value={name}
        maxLength={120}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        className="h-7 min-w-0 flex-1 rounded-md border px-2 text-sm"
      />
      <button
        type="submit"
        disabled={name.trim() === ''}
        className="rounded-md border px-2 py-1 text-sm"
      >
        OK
      </button>
      <button type="button" onClick={onCancel} className="rounded-md border px-2 py-1 text-sm">
        Cancel
      </button>
    </form>
  );
}
