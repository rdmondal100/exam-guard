import type * as React from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

/** Toasts for short success notices (M51). `system` follows `prefers-color-scheme`. */
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="system"
      position="bottom-right"
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
}
