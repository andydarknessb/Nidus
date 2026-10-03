import { ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Profile } from '../lib/profiles';
import { holdEndsAt, tapFinishesProfile, UP_NEXT_TILES, upNext, upNextLink, type Routine, type TickedHere } from '../lib/routines';
import { useStatusLine } from '../lib/status-line';
import { useCelebration, type RoutinesToday } from '../lib/use-routines-today';
import { Confetti, RoutineTile } from '../RoutinesPage';
import { EmptyWords } from './EmptyWords';
import { Button } from './ui/button';

// Up next, at the top of Home's right rail (docs/look.md, spec 0003): a tile for each of the first three people (two on a
// screen under 760 px tall, so the Pinned List keeps a row; home-layout.ts) with
// something left to do now, each showing that person's first Routine left among the part of the day's, what is left
// from earlier, and Any time. A tap ticks it, and the tile stays where it is, in the done look, for HOME_HOLD_MS: a double tap
// cannot tick the Routine that comes next, and a tap inside that time takes the tick back. Then the tile gives way to what that
// person has next, or goes when nothing is left. At the right of the heading, a link to the Routines chart that reads "All
// routines", or how many of today's Routines left the tiles do not show. When nobody has anything left it says so, and
// keeps the link. The card takes the height it needs (336 px with three tiles, 248 with two); the Pinned
// List takes the rest of the rail.
//
// A tap that finishes a person's day plays the celebration over this card, starting where the tile was; none under
// reduced motion. Once it is saved the status line says it, once, in the chart's words ("Ben: All done"). A tick that did not
// save says so under that person's tile. A tile that goes while it has the keyboard's focus hands the focus to the link.
//
// `failed` says the Household read has failed, which is why nothing has been read: the Routines are read once the
// Household Timezone is known.
export function UpNext({ routines, failed, onOpenRoutines, tiles: limit = UP_NEXT_TILES }: { routines: RoutinesToday; failed: boolean; onOpenRoutines: () => void; tiles?: number }) {
  const { loaded, part, problems, groups, done, toggle } = routines;
  const celebration = useCelebration(routines);
  const say = useStatusLine();
  const card = useRef<HTMLElement>(null);
  const link = useRef<HTMLButtonElement>(null);
  // What was ticked here and when, which upNext keeps in place, and the time it last looked: the one timer below moves the time
  // on when a hold ends, and nothing else does, so the card is drawn again then and not before.
  const [ticked, setTicked] = useState<TickedHere>({});
  const [now, setNow] = useState(() => Date.now());
  const { tiles, more } = upNext(groups, done, part, ticked, now, limit);
  const words = upNextLink(more);

  useEffect(() => {
    const ends = holdEndsAt(ticked, now);
    if (ends === null) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(ends - Date.now(), 0));
    return () => clearTimeout(timer);
  }, [ticked, now]);

  // A tile that goes while it has focus would leave the keyboard nowhere. A tile's ref is called with null as it goes, while
  // its button is still on the page and still has the focus, so what is noted there is read once the page has changed: if
  // the focus is now nowhere, it goes to the link in the heading.
  const focusLost = useRef(false);
  const watchTile = useCallback((tile: HTMLButtonElement | null) => {
    if (tile === null && card.current?.contains(document.activeElement)) focusLost.current = true;
  }, []);
  useEffect(() => {
    if (!focusLost.current) return;
    focusLost.current = false;
    if (!document.activeElement || document.activeElement === document.body) link.current?.focus();
  });

  function tap(profile: Profile, routine: Routine, button: HTMLElement) {
    const checking = !done.has(routine.id);
    const mine = groups.find((group) => group.profile.id === profile.id)?.routines ?? [];
    const section = card.current;
    const finishes = section !== null && tapFinishesProfile(mine, done, routine.id, checking);
    if (section && finishes) {
      // Where the burst starts: the middle of the tile, measured from the card's padding edge, which is the burst's own top.
      const box = button.getBoundingClientRect();
      const top = section.getBoundingClientRect().top + section.clientTop;
      celebration.start(profile.id, box.top + box.height / 2 - top);
    }
    // A tick is held in its place from now; a tap on a Routine that is held takes the tick back, and the hold with it.
    const at = Date.now();
    setTicked((was) => (checking ? { ...was, [routine.id]: at } : Object.fromEntries(Object.entries(was).filter(([id]) => id !== routine.id))));
    setNow(at);
    // Said once the tick has saved, so a day that is put back is never announced.
    void toggle(routine).then((saved) => {
      if (saved && finishes) say(`${profile.name}: All done`);
    });
  }

  return (
    <section ref={card} aria-label="Up next" className="relative flex flex-none flex-col gap-2 rounded-3xl bg-card p-3">
      {/* The heading row is 48 px tall for the link, which is how the card is the drawing's 336 px with three tiles. */}
      <div className="flex h-12 items-center justify-between gap-2 pl-1">
        <h2 className="font-display text-[22px] leading-7">Up next</h2>
        <Button ref={link} variant="quiet" aria-label={words.name} onClick={onOpenRoutines} className="h-12 gap-0.5 rounded-[14px] pr-1 pl-3 text-[15px] font-medium">
          {words.words}
          <ChevronRight aria-hidden className="size-5" />
        </Button>
      </div>
      {/* Until the first read lands the card keeps the room of the tiles it will show (80 each and 8 between: 16 rem for three, 10.5 rem
          for two), so the list card under it does not jump when they arrive. Once read, it takes the height it needs. */}
      {!loaded && (
        <div style={{ minHeight: `${limit * 5 + (limit - 1) * 0.5}rem` }}>
          {!failed && !routines.failed && <EmptyWords className="px-1">Loading</EmptyWords>}
          {(failed || routines.failed) && (
            <p role="alert" className="px-1 text-base">
              Could not load routines. Check your connection.
            </p>
          )}
        </div>
      )}
      {loaded && groups.length === 0 && <EmptyWords className="px-1">Nothing scheduled today.</EmptyWords>}
      {loaded && groups.length > 0 && tiles.length === 0 && <EmptyWords className="px-1">Nobody has anything left right now.</EmptyWords>}
      {tiles.length > 0 && (
        <ul className="flex flex-col gap-2">
          {tiles.map(({ profile, routine, done: held }) => (
            // Keyed by person, so the tile that was tapped stays under the finger and shows what is next once its hold ends.
            <li key={profile.id}>
              <RoutineTile ref={watchTile} routine={routine} color={profile.color} who={profile.name} done={held} problem={problems[profile.id]} onTap={(button) => tap(profile, routine, button)} />
              {/* The sentence is drawn inside the tile, where nothing moves for it; a button's insides are not announced, so a live
                  region off screen says it to a screen reader, beside the tile of the person it is about. */}
              {problems[profile.id] && (
                <p role="alert" className="sr-only">
                  {problems[profile.id]}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {Object.entries(celebration.bursts).map(([profileId, burst]) => (
        <Confetti key={`${profileId}-${burst.id}`} at={burst.at} onDone={() => celebration.land(profileId, burst.id)} />
      ))}
    </section>
  );
}
