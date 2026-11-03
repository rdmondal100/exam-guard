import type { ReactNode } from 'react';

interface Props {
  title: string;
  description?: string;
  children: ReactNode;
  /** A short "Saved" line, or `null`. */
  notice?: string | null;
  error?: string | null;
}

/** One section of the Settings page: heading, fields, and the outcome of its last action. */
export function SettingsCard({ title, description, children, notice, error }: Props) {
  return (
    <section
      aria-label={title}
      className="flex max-w-2xl flex-col gap-3 rounded-md border border-border p-4"
    >
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && <p className="text-sm text-muted">{description}</p>}
      </div>
      {children}
      {notice && (
        <p role="status" className="text-sm text-green-700">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
