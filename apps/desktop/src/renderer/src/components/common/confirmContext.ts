import { createContext, type ReactNode } from 'react';

export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  /** The confirm button's text; "Continue" by default. */
  confirmLabel?: string;
  cancelLabel?: string;
  /** A red confirm button, for deleting and ending things. */
  destructive?: boolean;
}

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

export const ConfirmContext = createContext<ConfirmFn | null>(null);
