import { Button } from '@/components/ui/button';
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
    <fieldset className="flex flex-col gap-2 rounded-md border border-border p-4">
      <legend className="px-1 text-sm font-medium">Marking criteria</legend>
      {criteria.map((c, index) => {
        const badMarks = c.maxMarks.trim() !== '' && parseMarks(c.maxMarks) === null;
        return (
          <div key={index} className="flex items-center gap-2">
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
              className="w-24 aria-[invalid=true]:border-red-700"
              type="number"
              min={0.5}
              step={0.5}
              placeholder="marks"
              value={c.maxMarks}
              onChange={(e) => set(index, { maxMarks: e.target.value })}
            />
            <Button
              type="button"
              variant="outline"
              aria-label={`Remove criterion ${index + 1}`}
              onClick={() => onChange(criteria.filter((_, i) => i !== index))}
            >
              Remove
            </Button>
          </div>
        );
      })}
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          onClick={() => onChange([...criteria, { name: '', maxMarks: '' }])}
        >
          Add criterion
        </Button>
        <span className="text-sm font-medium">Total: {draftTotal(draft)} marks</span>
      </div>
    </fieldset>
  );
}
