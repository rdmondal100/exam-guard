import { PlusIcon, Trash2Icon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  draftTotal,
  parseMarks,
  type CriterionDraft,
  type QuestionDraft,
} from '@/lib/questionDraft';

interface Props {
  draft: QuestionDraft;
  onChange: (criteria: CriterionDraft[]) => void;
}

/** Marking guide rows. The question's marks are the running total of the rows. */
export function CriteriaEditor({ draft, onChange }: Props) {
  const { criteria } = draft;
  const set = (index: number, patch: Partial<CriterionDraft>) =>
    onChange(criteria.map((c, i) => (i === index ? { ...c, ...patch } : c)));

  return (
    <Card role="group" aria-label="Marking criteria">
      <CardHeader>
        <CardTitle>Marking criteria</CardTitle>
        <CardDescription>The question&apos;s marks are the total of these rows.</CardDescription>
        <CardAction>
          <Badge variant="primary" className="text-sm">
            Total: {draftTotal(draft)} marks
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {criteria.map((c, index) => {
          const badMarks = c.maxMarks.trim() !== '' && parseMarks(c.maxMarks) === null;
          return (
            <div key={index} className="flex items-center gap-2">
              <span className="w-6 text-right text-sm text-muted-foreground">{index + 1}.</span>
              <Input
                aria-label={`Criterion ${index + 1} name`}
                placeholder="e.g. Correct output"
                maxLength={200}
                value={c.name}
                onChange={(e) => set(index, { name: e.target.value })}
              />
              <Input
                aria-label={`Criterion ${index + 1} marks`}
                aria-invalid={badMarks}
                className="w-24"
                type="number"
                min={0.5}
                step={0.5}
                placeholder="marks"
                value={c.maxMarks}
                onChange={(e) => set(index, { maxMarks: e.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove criterion ${index + 1}`}
                onClick={() => onChange(criteria.filter((_, i) => i !== index))}
              >
                <Trash2Icon />
              </Button>
            </div>
          );
        })}
      </CardContent>
      <CardFooter>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...criteria, { name: '', maxMarks: '' }])}
        >
          <PlusIcon />
          Add criterion
        </Button>
      </CardFooter>
    </Card>
  );
}
