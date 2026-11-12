import { Loader2Icon, RotateCcwIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CenteredScreen } from '../../components/common/CenteredScreen';
import { ErrorAlert } from '../../components/common/ErrorAlert';

interface Props {
  /** `null` while loading; the reason when it failed. */
  error: string | null;
  onRetry: () => void;
}

/** Shown between a restart and the exam screen while the saved answers are loaded. */
export function RestoringScreen({ error, onRetry }: Props) {
  return (
    <CenteredScreen>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl">
            {!error && <Loader2Icon className="size-5 animate-spin text-primary" aria-hidden />}
            Restoring your work…
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          {error ? (
            <>
              <ErrorAlert>{error}</ErrorAlert>
              <p className="text-muted-foreground">
                Your answers are safe on the teacher&apos;s computer. The exam opens once they load,
                so nothing you type can replace them.
              </p>
              <Button className="w-fit" onClick={onRetry}>
                <RotateCcwIcon />
                Try again
              </Button>
            </>
          ) : (
            <p className="text-muted-foreground">Loading what you saved before the restart.</p>
          )}
        </CardContent>
      </Card>
    </CenteredScreen>
  );
}
