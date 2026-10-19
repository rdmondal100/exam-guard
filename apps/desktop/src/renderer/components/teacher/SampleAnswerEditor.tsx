import { lazy, Suspense } from 'react';

// Monaco is large; load it (and its workers) only when a question form opens.
const MonacoField = lazy(() => import('./MonacoField'));

interface Props {
  value: string;
  /** `c`, `cpp`, `js` or `text`. */
  language: string;
  onChange: (value: string) => void;
}

export function SampleAnswerEditor(props: Props) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading editor…</p>}>
      <MonacoField {...props} />
    </Suspense>
  );
}
