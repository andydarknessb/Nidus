import type { RoutinesToday } from '../lib/use-routines-today';
import { RoutinesRail } from '../RoutinesPage';
import { PinnedListRail } from '../SharedListsPage';

// The Home screen's right-hand column: today's Routines above the pinned Shared List. `timezone` is
// null until the Household is read, and `failed` says that read has failed, so the Routines card can
// say so.
//
// The two share the right rail and keep 13 rem each (the pinned list's controls and an item need
// that): past it the card shrinks and scrolls, so the wall never does.
export function HomeRail({ timezone, routines, failed }: { timezone: string | null; routines: RoutinesToday; failed: boolean }) {
  return (
    <div className="flex min-h-0 flex-col gap-4">
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
        <PinnedListRail />
      </div>
    </div>
  );
}
