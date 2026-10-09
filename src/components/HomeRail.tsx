import type { RoutinesToday } from '../lib/use-routines-today';
import { PinnedListCard } from '../SharedListsPage';
import { UpNext } from './UpNext';

// The Home screen's rail: Up next above the pinned Shared List (a column, at the right of the days), or in portrait (docs/specs/0009)
// a `row` under the days, with Up next at the left, 20 rem wide, and the pinned list beside it taking the rest. `failed` says the Household's read
// has failed, so Up next can say so. `tiles` is how many tiles Up next may show. `onOpenRoutines` opens the chart, from Up next's link, and `onOpenLists` the
// Lists screen, from the pinned list's.
//
// Up next takes the height it needs and the pinned list takes the rest of the rail. Neither may be wider than the
// rail: a long item or name gives way inside its card (the grid's one column may shrink to nothing). In the row the rail is as
// tall as Up next (and the grid gives it three tiles' worth at least): the list's card fills its cell without giving it any height, so
// a long list shows the rows that fit and says how many more, and never grows the row or pushes the days up.
export function HomeRail({
  routines,
  failed,
  tiles,
  row,
  onOpenRoutines,
  onOpenLists,
}: {
  routines: RoutinesToday;
  failed: boolean;
  tiles: number;
  row: boolean;
  onOpenRoutines: () => void;
  onOpenLists: () => void;
}) {
  return (
    <div className={row ? 'grid min-h-0 min-w-0 grid-cols-[min(20rem,50%)_minmax(0,1fr)] gap-4' : 'flex min-h-0 min-w-0 flex-col gap-4'}>
      <UpNext routines={routines} failed={failed} onOpenRoutines={onOpenRoutines} tiles={tiles} />
      <div className={row ? 'relative min-w-0 *:absolute *:inset-0' : 'grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]'}>
        <PinnedListCard onOpenLists={onOpenLists} />
      </div>
    </div>
  );
}
