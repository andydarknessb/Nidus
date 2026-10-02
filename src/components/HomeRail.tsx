import type { RoutinesToday } from '../lib/use-routines-today';
import { TodaysMealsCard } from '../MealsPage';
import { PinnedListRail } from '../SharedListsPage';
import { UpNext } from './UpNext';

// The Home screen's right-hand column: today's Meals (when any is planned) above Up next above the pinned
// Shared List. `timezone` is null until the Household is read, and `failed` says that read has failed, so
// Up next can say so.
//
// Up next takes the height it needs and the pinned list takes the rest of the rail, shrinking and scrolling
// past it, so the wall never does.
export function HomeRail({
  timezone,
  routines,
  failed,
  onOpenRoutines,
}: {
  timezone: string | null;
  routines: RoutinesToday;
  failed: boolean;
  onOpenRoutines: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-col gap-4">
      {timezone && <TodaysMealsCard timezone={timezone} />}
      <UpNext routines={routines} failed={failed} onOpenRoutines={onOpenRoutines} />
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)]">
        <PinnedListRail />
      </div>
    </div>
  );
}
