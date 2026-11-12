import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
    <form onSubmit={submit} className="flex items-center gap-1.5">
      <Input
        autoFocus
        aria-label={label}
        placeholder={label}
        value={name}
        maxLength={120}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        className="h-8"
      />
      <Button type="submit" size="sm" disabled={name.trim() === ''}>
        OK
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}
