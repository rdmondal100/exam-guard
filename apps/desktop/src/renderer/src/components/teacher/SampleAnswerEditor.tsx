import { lazy, Suspense } from 'react';
import { LoadingLine } from '../common/Spinner';

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
    <Suspense fallback={<LoadingLine>Loading editor…</LoadingLine>}>
      <MonacoField {...props} />
    </Suspense>
  );
}
