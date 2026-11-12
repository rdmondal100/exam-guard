import type { ReactElement, ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface Props {
  label: ReactNode;
  /** One element that takes a ref (a DOM element or a forwardRef component). */
  children: ReactElement;
  side?: 'top' | 'right' | 'bottom' | 'left';
}

/** A tooltip on any element (M51); replaces `title=` hints. */
export function Hint({ label, children, side = 'top' }: Props) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}
