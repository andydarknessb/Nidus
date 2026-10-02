import type { RoutinesToday } from '../lib/use-routines-today';
import { PinnedListCard } from '../SharedListsPage';
import { UpNext } from './UpNext';

// The Home screen's right-hand column: Up next above the pinned Shared List. `failed` says the Household's read
// has failed, so Up next can say so. `onOpenRoutines` opens the chart, from Up next's link, and `onOpenLists` the
// Lists screen, from the pinned list's.
//
// Up next takes the height it needs and the pinned list takes the rest of the rail. Neither may be wider than the
// rail: a long item or name gives way inside its card (the grid's one column may shrink to nothing).
export function HomeRail({
  routines,
  failed,
  onOpenRoutines,
  onOpenLists,
}: {
  routines: RoutinesToday;
  failed: boolean;
  onOpenRoutines: () => void;
  onOpenLists: () => void;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-4">
      <UpNext routines={routines} failed={failed} onOpenRoutines={onOpenRoutines} />
      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]">
        <PinnedListCard onOpenLists={onOpenLists} />
      </div>
    </div>
  );
}
