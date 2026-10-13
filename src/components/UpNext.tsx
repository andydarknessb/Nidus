import { ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import type { Profile } from '../lib/profiles';
import { UP_NEXT_TILES, type RoutineChart } from '../lib/routine-chart';
import type { Routine } from '../lib/routines';
import { useStatusLine } from '../lib/status-line';
import { Confetti, RoutineTile } from './RoutineColumn';
import { EmptyWords } from './EmptyWords';
import { ReadState } from './ReadState';
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
export function UpNext({ routines, failed, onOpenRoutines, tiles: limit = UP_NEXT_TILES }: { routines: RoutineChart; failed: boolean; onOpenRoutines: () => void; tiles?: number }) {
  // The Household read that failed is why nothing has been read: the Routines are read once the Household Timezone is known.
  const state = routines.state === 'loading' && failed ? 'failed' : routines.state;
  const ready = state === 'ready';
  const say = useStatusLine();
  const card = useRef<HTMLElement>(null);
  const link = useRef<HTMLButtonElement>(null);
  // What was ticked here and when is the chart's to keep in place (its holds), and it draws the card again when a hold ends.
  const { tiles, link: words, scheduled } = routines.upNext(limit);

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
    // The same decision as a Profile's column makes, and the burst starts where it says (src/lib/routine-chart.ts).
    // Said once the tick has saved, so a day that is put back is never announced.
    void routines.tap(routine, { button, frame: card.current }).then(({ saved, finished }) => {
      if (saved && finished) say(`${profile.name}: All done`);
    });
  }

  return (
    <section ref={card} aria-label="Up next" className="relative flex flex-none flex-col gap-2 rounded-3xl bg-card p-3 phone:rounded-[22px]">
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
      {/* What was read for yesterday keeps its tiles on screen, unchecked, until today's read lands, as the chart's columns do. */}
      {!ready && !scheduled && (
        <div style={{ minHeight: `${limit * 5 + (limit - 1) * 0.5}rem` }}>
          <ReadState of="routines" read={{ state }} className="px-1" alert="px-1 text-base" />
        </div>
      )}
      {ready && !scheduled && <EmptyWords className="px-1">Nothing scheduled today.</EmptyWords>}
      {ready && scheduled && tiles.length === 0 && <EmptyWords className="px-1">Nobody has anything left right now.</EmptyWords>}
      {tiles.length > 0 && (
        <ul className="flex flex-col gap-2">
          {tiles.map(({ profile, routine, done: held, problem }) => (
            // Keyed by person, so the tile that was tapped stays under the finger and shows what is next once its hold ends.
            <li key={profile.id}>
              <RoutineTile ref={watchTile} routine={routine} color={profile.color} who={profile.name} done={held} problem={problem} onTap={(button) => tap(profile, routine, button)} />
              {/* The sentence is drawn inside the tile, where nothing moves for it; a button's insides are not announced, so a live
                  region off screen says it to a screen reader, beside the tile of the person it is about. */}
              {problem && (
                <p role="alert" className="sr-only">
                  {problem}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {routines.columns.map(({ profile, burst }) => burst && <Confetti key={`${profile.id}-${burst.id}`} at={burst.at} onDone={burst.land} />)}
    </section>
  );
}
