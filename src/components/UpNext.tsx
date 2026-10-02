import { ChevronRight } from 'lucide-react';
import { useRef } from 'react';
import type { Profile } from '../lib/profiles';
import { tapFinishesProfile, upNext, type Routine } from '../lib/routines';
import { useCelebration, type RoutinesToday } from '../lib/use-routines-today';
import { Confetti, RoutineTile } from '../RoutinesPage';
import { Button } from './ui/button';

// Up next, at the top of Home's right rail (docs/look.md, spec 0003): a tile for each of the first three people with
// something left to do now, each showing that person's first Routine left among the part of the day's, what is left
// from earlier, and Any time. A tap ticks it and the tile moves on to what that person has next, or goes. Under them, a
// link to the Routines chart with a count of what the tiles do not show. When nobody has anything left it says so. The
// card takes the height it needs; the Pinned List takes the rest of the rail.
//
// A tap that finishes a person's day plays the celebration over this card, starting where the tile was; none under
// reduced motion. A tick that did not save says so under that person's tile.
//
// `failed` says the Household read has failed, which is why nothing has been read: the Routines are read once the
// Household Timezone is known.
export function UpNext({ routines, failed, onOpenRoutines }: { routines: RoutinesToday; failed: boolean; onOpenRoutines: () => void }) {
  const { loaded, part, problems, groups, done, toggle } = routines;
  const celebration = useCelebration(routines);
  const card = useRef<HTMLElement>(null);
  const { tiles, more } = upNext(groups, done, part);

  function tap(profile: Profile, routine: Routine, button: HTMLElement) {
    const mine = groups.find((group) => group.profile.id === profile.id)?.routines ?? [];
    if (card.current && tapFinishesProfile(mine, done, routine.id, true)) {
      // Where the burst starts: the middle of the tile, measured from the card's padding edge, which is the burst's own top.
      const box = button.getBoundingClientRect();
      const top = card.current.getBoundingClientRect().top + card.current.clientTop;
      celebration.start(profile.id, box.top + box.height / 2 - top);
    }
    void toggle(routine);
  }

  return (
    <section ref={card} aria-label="Up next" className="relative flex flex-none flex-col gap-2 rounded-3xl bg-card p-3">
      <h2 className="flex h-9 items-center px-1 font-display text-[22px] leading-7">Up next</h2>
      {!loaded && !failed && !routines.failed && <p className="px-1 text-base">Loading</p>}
      {(failed || routines.failed) && !loaded && (
        <p role="alert" className="px-1 text-base">
          Could not load Routines. Check your connection.
        </p>
      )}
      {loaded && groups.length === 0 && <p className="px-1 text-base">Nothing scheduled today.</p>}
      {loaded && groups.length > 0 && tiles.length === 0 && <p className="px-1 text-base">Nobody has anything left right now.</p>}
      {tiles.length > 0 && (
        <ul className="flex flex-col gap-2">
          {tiles.map(({ profile, routine }) => (
            // Keyed by person, so the tile that was tapped stays under the finger and shows what is next.
            <li key={profile.id} className="flex flex-col gap-1.5">
              <RoutineTile routine={routine} color={profile.color} who={profile.name} onTap={(button) => tap(profile, routine, button)} />
              {problems[profile.id] && (
                <p role="alert" className="px-1 text-[15px] leading-5">
                  {problems[profile.id]}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <Button variant="quiet" onClick={onOpenRoutines} className="h-12 justify-start gap-2 rounded-[14px] px-3 text-[15px] font-medium">
        All routines
        {more > 0 && <span className="font-normal">and {more} more</span>}
        <ChevronRight aria-hidden className="ml-auto size-5" />
      </Button>
      {Object.entries(celebration.bursts).map(([profileId, burst]) => (
        <Confetti key={`${profileId}-${burst.id}`} at={burst.at} onDone={() => celebration.land(profileId, burst.id)} />
      ))}
    </section>
  );
}
