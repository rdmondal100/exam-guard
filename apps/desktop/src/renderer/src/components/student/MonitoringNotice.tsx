import { useState } from 'react';
import { EyeIcon, GraduationCapIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { CenteredScreen } from '../common/CenteredScreen';
import { ErrorAlert } from '../common/ErrorAlert';
import { Spinner } from '../common/Spinner';

interface Props {
  /** A practice exam (M53): nothing is recorded, so there is nothing to agree to. */
  practice: boolean;
  onAccepted: () => void;
  onBack: () => void;
}

/** What ExamGuard observes during the exam. Accepting tells the server and enters the lobby. */
export function MonitoringNotice({ practice, onAccepted, onBack }: Props) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.examguard.confirmJoin();
      if (result.ok) return onAccepted();
      setError(result.message);
    } catch {
      setError('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (practice) {
    return (
      <CenteredScreen>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <GraduationCapIcon className="size-5 text-primary" aria-hidden />
              Practice exam
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm leading-relaxed">
            <p>
              This is a practice exam. Nothing on this computer is recorded and nothing is graded.
              Use it to try the editor, Run, Files and the terminal before a real exam.
            </p>
            {error && <ErrorAlert>{error}</ErrorAlert>}
          </CardContent>
          <CardFooter className="justify-between">
            <Button variant="outline" onClick={onBack} disabled={busy}>
              Back
            </Button>
            <Button onClick={() => void accept()} disabled={busy}>
              {busy && <Spinner />}
              Continue
            </Button>
          </CardFooter>
        </Card>
      </CenteredScreen>
    );
  }

  return (
    <CenteredScreen width="lg">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl">
            <EyeIcon className="size-5 text-primary" aria-hidden />
            Monitoring notice
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="space-y-3 text-sm leading-relaxed">
            <p>While this exam is running, ExamGuard records the following on this computer:</p>
            <ul className="list-disc space-y-1 pl-5 marker:text-muted-foreground">
              <li>Which application is in front, its window title, and when you switch away.</li>
              <li>
                The website you have open in Chrome or Edge (its full address; a private window is
                recorded as private).
              </li>
              <li>
                Applications you open during the exam, extra screens, and locking the computer.
              </li>
              <li>
                Screenshots when you leave the exam window, and about every 20 seconds while away.
              </li>
              <li>Small preview images of your exam screen that the teacher can watch live.</li>
              <li>Your answers, saved as you type, and any code you run.</li>
            </ul>
            <p className="text-muted-foreground">
              ExamGuard does not block applications or websites and does not change your internet or
              your computer. Your teacher reviews this record and decides what it means.
            </p>
          </div>
          <label className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={checked}
              onCheckedChange={(value) => setChecked(value === true)}
            />
            <span>I have read this notice and I agree to be monitored during the exam.</span>
          </label>
          {error && <ErrorAlert>{error}</ErrorAlert>}
        </CardContent>
        <CardFooter className="justify-between">
          <Button variant="outline" onClick={onBack} disabled={busy}>
            Back
          </Button>
          <Button onClick={() => void accept()} disabled={!checked || busy}>
            {busy && <Spinner />}
            {busy ? 'Please wait…' : 'Accept and continue'}
          </Button>
        </CardFooter>
      </Card>
    </CenteredScreen>
  );
}
