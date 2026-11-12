import { UserRoundIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { CenteredScreen } from '../common/CenteredScreen';

interface Props {
  name: string;
  examTitle: string;
  onYes: () => void;
  onNo: () => void;
}

/** "Is this you?" step, so a mistyped ID is caught before the notice. */
export function ConfirmName({ name, examTitle, onYes, onNo }: Props) {
  return (
    <CenteredScreen>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Is this you?</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 rounded-lg border bg-muted/40 p-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <UserRoundIcon className="size-6" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="truncate text-xl font-semibold">{name}</p>
              <p className="text-sm text-muted-foreground">{examTitle}</p>
            </div>
          </div>
        </CardContent>
        <CardFooter className="justify-between">
          <Button variant="outline" onClick={onNo}>
            No, go back
          </Button>
          <Button onClick={onYes}>Yes, that is me</Button>
        </CardFooter>
      </Card>
    </CenteredScreen>
  );
}
