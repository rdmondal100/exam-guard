import { useEffect, useMemo, useState } from 'react';
import type { RosterEntry } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import type { ExamApi } from '@/api/examApi';
import type { RosterView } from '@/hooks/useRoster';
import { usePageVisible } from '@/hooks/usePageVisible';
import {
  GRID_SORTS,
  gridOrder,
  pageCount,
  pageOf,
  streamIds,
  watchKey,
  type GridSort,
} from '@/lib/thumbGrid';
import { ThumbTile } from './ThumbTile';
import { ThumbStatsLine } from './ThumbStatsLine';

interface Props {
  api: ExamApi;
  roster: RosterView;
  students: RosterEntry[];
  selectedId: string | null;
  onSelect: (student: RosterEntry) => void;
}

/**
 * The thumbnail grid (M33): 30 students per page, sorted by risk, name or status. Only the
 * connected students on the visible page stream their screen; changing page, hiding the grid or
 * minimizing the window stops the others.
 */
export function ThumbnailGrid({ api, roster, students, selectedId, onSelect }: Props) {
  const [sort, setSort] = useState<GridSort>('risk');
  const [page, setPage] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const visible = usePageVisible();
  const ordered = useMemo(() => gridOrder(students, sort), [students, sort]);
  const pages = pageCount(ordered.length);
  const current = Math.min(page, pages - 1);
  const tiles = pageOf(ordered, current);
  const ids = visible ? streamIds(tiles) : [];
  const key = watchKey(ids);
  const { watchThumbs } = roster;

  useEffect(() => {
    watchThumbs(key ? key.split(',') : []);
  }, [key, watchThumbs]);
  useEffect(() => () => watchThumbs([]), [watchThumbs]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(timer);
  }, []);

  if (students.length === 0) return <p className="text-sm text-muted">Nobody has joined yet.</p>;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1">
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as GridSort)}
            className="rounded-md border border-border bg-card px-2 py-1"
          >
            {GRID_SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            Previous
          </Button>
          <span aria-live="polite">
            Page {current + 1} of {pages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={current >= pages - 1}
            onClick={() => setPage(current + 1)}
          >
            Next
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-2">
        {tiles.map((s) => (
          <ThumbTile
            key={s.id}
            student={s}
            store={roster.thumbs}
            now={now}
            selected={s.id === selectedId}
            onSelect={onSelect}
          />
        ))}
      </div>
      <ThumbStatsLine api={api} />
    </div>
  );
}
