import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
    <form onSubmit={submit} className="space-y-2">
      <label className="text-sm font-medium" htmlFor="manual-ip">
        Not listed? Enter the address of the teacher computer
      </label>
      <div className="flex gap-2">
        <Input
          id="manual-ip"
          placeholder="192.168.1.20 or 192.168.1.20:47820"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit" disabled={busy || text.trim() === ''}>
          Connect
        </Button>
      </div>
      {invalid && <p className="text-sm text-red-700">Enter an IP address like 192.168.1.20.</p>}
    </form>
  );
}
