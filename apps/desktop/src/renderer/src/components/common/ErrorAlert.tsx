import type { ReactNode } from 'react';
import { CircleAlertIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

interface Props {
  children: ReactNode;
  title?: string;
  className?: string;
}

/** The red error box (M51): `role="alert"`, an icon, the message. */
export function ErrorAlert({ children, title, className }: Props) {
  return (
    <Alert variant="destructive" className={className}>
      <CircleAlertIcon />
      {title && <AlertTitle>{title}</AlertTitle>}
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
