import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface Option {
  value: string;
  label: string;
  disabled?: boolean;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: readonly Option[];
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'default';
  className?: string;
  id?: string;
  'aria-label'?: string;
}

/** Radix items cannot have an empty value; the native selects used '' for "none" / "all". */
const EMPTY = '__eg-empty__';
const toRadix = (v: string) => (v === '' ? EMPTY : v);
const fromRadix = (v: string) => (v === EMPTY ? '' : v);

/** A shadcn Select fed from a list, with the same string-in / string-out shape as `<select>`. */
export function OptionSelect({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  size,
  className,
  id,
  'aria-label': ariaLabel,
}: Props) {
  return (
    <Select
      value={toRadix(value)}
      onValueChange={(v) => onChange(fromRadix(v))}
      disabled={disabled}
    >
      <SelectTrigger id={id} size={size} aria-label={ariaLabel} className={cn('w-full', className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={toRadix(o.value)} disabled={o.disabled}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
