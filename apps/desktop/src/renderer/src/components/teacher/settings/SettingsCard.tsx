import type { ReactNode } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ErrorAlert } from '../../common/ErrorAlert';

interface Props {
  title: string;
  description?: string;
  children: ReactNode;
  /** The section's buttons, under a divider. */
  footer?: ReactNode;
  error?: string | null;
}

/**
 * One section of the Settings page (M51): a card with its fields and its own save button.
 * Success shows as a toast (`useAction`); an error stays here.
 */
export function SettingsCard({ title, description, children, footer, error }: Props) {
  return (
    <Card aria-label={title} role="region">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {children}
        {error && <ErrorAlert>{error}</ErrorAlert>}
      </CardContent>
      {footer && <CardFooter className="flex-wrap border-t">{footer}</CardFooter>}
    </Card>
  );
}
