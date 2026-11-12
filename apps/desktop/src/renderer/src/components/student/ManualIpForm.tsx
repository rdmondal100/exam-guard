import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { parseHostAddress, type HostAddress } from '@/lib/hostAddress';

interface Props {
  busy: boolean;
  onSubmit: (target: HostAddress) => void;
}

export function ManualIpForm({ busy, onSubmit }: Props) {
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState(false);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const target = parseHostAddress(text);
    setInvalid(!target);
    if (target) onSubmit(target);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <Label htmlFor="manual-ip">Not listed? Enter the address of the teacher computer</Label>
      <div className="flex gap-2">
        <Input
          id="manual-ip"
          placeholder="192.168.1.20 or 192.168.1.20:47820"
          aria-invalid={invalid || undefined}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit" variant="secondary" disabled={busy || text.trim() === ''}>
          Connect
        </Button>
      </div>
      {invalid && (
        <p className="text-sm text-destructive">Enter an IP address like 192.168.1.20.</p>
      )}
    </form>
  );
}
