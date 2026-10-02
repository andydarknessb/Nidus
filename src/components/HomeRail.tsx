import type { RoutinesToday } from '../lib/use-routines-today';
import { TodaysMealsCard } from '../MealsPage';
import { RoutinesRail } from '../RoutinesPage';
import { PinnedListCard } from '../SharedListsPage';

// The Home screen's right-hand column: today's Meals (when any is planned) above today's Routines
// above the pinned Shared List. `timezone` is null until the Household is read, and `failed` says that
// read has failed, so the Routines card can say so. `onOpenLists` opens the Lists screen, from the pinned list's link.
//
// Today's meals take the height they need, and nothing at all when none is planned, so the Routines
// rail and the pinned list then share the right rail exactly as before. The two keep 13 rem each
// (the pinned list's controls and an item need that): past it the card shrinks and scrolls, so
// the wall never does.
export function HomeRail({ timezone, routines, failed, onOpenLists }: { timezone: string | null; routines: RoutinesToday; failed: boolean; onOpenLists: () => void }) {
  return (
    <div className="flex min-h-0 flex-col gap-4">
      {timezone && <TodaysMealsCard timezone={timezone} />}
      <div className="grid min-h-[27rem] flex-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
        {timezone ? (
          <RoutinesRail routines={routines} />
        ) : (
          <aside aria-label="Today's Routines" className="rounded-3xl bg-card p-4">
            {failed && (
              <p role="alert" className="text-base">
                Could not load Routines. Check your connection.
              </p>
            )}
          </aside>
        )}
        <PinnedListCard onOpenLists={onOpenLists} />
      </div>
    </div>
  );
}
