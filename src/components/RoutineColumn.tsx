import { cn } from 'cn';
import { Star, type LucideIcon } from 'lucide-react';
import { Fragment, useRef, type CSSProperties, type ReactNode, type Ref } from 'react';
import { personStyle } from '../lib/look';
import { PROFILE_PALETTE, type Profile } from '../lib/profiles';
import { PART_ICON, WORDS, timeWord } from '../lib/routine-chart';
import { RoutinePicture } from '../lib/routine-pictures';
import { tapRoutine } from '../lib/routine-tap';
import { groupByTimeOfDay, partDone, partView, routineProgress, type Burst, type ChartPart, type PartView, type Routine } from '../lib/routines';
import { EmptyWords } from './EmptyWords';
import { EmptyRing, MAX_PIPS, PersonDisc, Pips, Tick } from './people';

// One Profile's Routines as the Wall's chart and the phone's Routines tab draw them, and the tile that Up next shares. What a tap does
// is src/lib/routine-tap.ts; the Wall's column (src/RoutinesPage.tsx) and the phone's card (src/phone/PhoneRoutines.tsx) are the
// layout around RoutineColumn and nothing more.

// The pieces of one burst, one in each colour of the Profile palette: how far each flies sideways (as a
// percentage of the group's width), how far it rises first and how far it then falls (rem, from where the
// burst starts), and how far it turns (degrees). Fixed, so a burst looks the same each time and a render
// stays pure. Each starts a little after the one before it (index.css), so the last piece is the last to land.
const CONFETTI = [
  [-40, -3, 6, -380],
  [28, -4, 8, 460],
  [-16, -4.5, 5, 300],
  [44, -2.5, 7, -520],
  [-48, -2, 8.5, 410],
  [10, -5, 6, -300],
  [-30, -3.5, 9, 560],
  [38, -4, 5.5, -440],
  [-4, -3, 7.5, 340],
  [48, -2, 8.5, -480],
] as const;

// A short burst of confetti over one Profile's group (a column of the chart, or Up next), starting `at` px down it: at
// the Routine that was tapped, wherever the group is scrolled to. It is drawn over the group but never in the way of a tap
// or of the layout, hidden from assistive technology (the words "All done" say it), and gone from the page once its last
// piece has landed.
export function Confetti({ at, onDone }: { at: number; onDone: () => void }) {
  return (
    <span aria-hidden className="confetti pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]" style={{ '--at': `${at}px` } as CSSProperties}>
      {CONFETTI.map(([sideways, rise, fall, turn], index) => (
        <span
          key={index}
          className="confetti-piece"
          style={
            {
              backgroundColor: PROFILE_PALETTE[index]?.hex,
              '--sideways': sideways,
              '--rise': rise,
              '--fall': fall,
              '--turn': `${turn}deg`,
              '--delay': `${index * 20}ms`,
            } as CSSProperties
          }
          onAnimationEnd={index === CONFETTI.length - 1 ? onDone : undefined}
        />
      ))}
    </span>
  );
}

// A Routine's tile (docs/look.md, A Routine tile): the whole tile is the button, 80 px tall, with the picture in a 52 px disc,
// the words on up to two lines and a 44 px ring. To do, the ring is the person's strong colour; done, the tile is filled
// with their base colour and shows a tick, and its words stay as they are, not struck through. On the chart it is a card
// on the person's column and says whether it is ticked. In Up next, which names the person under the words (`who`), it is
// a tile on a card; a Routine ticked there stays in the done look for a moment (HOME_HOLD_MS), and tapped then it is unticked. The
// name line carries the person's initial, so a child tells their tile from a sibling's by more than its colour and picture. When their
// tick did not save (`problem`, Up next only) the sentence takes the place of the name line, inside the tile: a line of its own under
// it would push the tiles below down from under the finger.
export function RoutineTile({
  routine,
  color,
  done = false,
  who,
  problem,
  ref,
  onTap,
}: {
  routine: Routine;
  color: string;
  done?: boolean;
  who?: string;
  problem?: string | undefined;
  // Called with the button as it appears and with null as it goes (Up next watches that, to keep the keyboard's place).
  ref?: Ref<HTMLButtonElement>;
  onTap: (button: HTMLElement) => void;
}) {
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={done}
      {...(who === undefined ? {} : { 'aria-label': `Mark ${routine.title} done for ${who}` })}
      onClick={(event) => onTap(event.currentTarget)}
      className={cn(
        'person flex h-20 w-full items-center gap-3 rounded-[18px] px-2.5 text-left select-none transition-transform duration-75 active:translate-y-0.5',
        done ? 'bg-person-base text-person-on-base' : cn('active:bg-accent', who === undefined ? 'bg-card' : 'bg-muted'),
      )}
      style={personStyle(color)}
    >
      <span
        aria-hidden
        className={cn('flex size-[52px] shrink-0 items-center justify-center rounded-full', done ? 'bg-person-done-disc text-person-done-picture' : 'bg-person-fill text-person-strong')}
      >
        <RoutinePicture picture={routine.picture} />
      </span>
      {who === undefined ? (
        <span dir="auto" className={cn(WORDS, 'line-clamp-2 flex-1 text-[19px] leading-[1.2]', done ? 'font-semibold' : 'font-medium')}>
          {routine.title}
        </span>
      ) : (
        <span className="flex min-w-0 flex-1 flex-col">
          {/* With a sentence beside it the Routine's words keep one line, so the tile (80 px) holds the sentence on up to three. */}
          <span dir="auto" className={cn(WORDS, problem ? 'line-clamp-1' : 'line-clamp-2', 'text-[19px] leading-6', done ? 'font-semibold' : 'font-medium')}>
            {routine.title}
          </span>
          {problem ? (
            <span className="text-start text-[15px] leading-[18px]">{problem}</span>
          ) : (
            <span className="flex items-center gap-1.5">
              <PersonDisc name={who} color={color} size={24} />
              <span dir="auto" className={cn('min-w-0 truncate text-start text-sm leading-[1.2857]', !done && 'text-muted-foreground')}>
                {who}
              </span>
            </span>
          )}
        </span>
      )}
      {done ? <Tick color={color} /> : <EmptyRing color={color} />}
    </button>
  );
}

// The small heading over a group of tiles: the part of the day (with its icon), Left from earlier or Any time.
function GroupLabel({ icon: Icon, children, status }: { icon?: LucideIcon | undefined; children: ReactNode; status?: ReactNode }) {
  return (
    <div className="flex h-[22px] flex-none items-center justify-between gap-2">
      <h4 className="flex items-center gap-1.5 px-1 text-[14.5px] leading-[18px] font-medium text-muted-foreground">
        {Icon && <Icon aria-hidden className="size-4" />}
        {children}
      </h4>
      {status}
    </div>
  );
}

// The tiles of one group: a list of Routine tiles on a person's colour, each the whole button.
function Tiles({ list, profile, done, onTap }: { list: Routine[]; profile: Profile; done: ReadonlySet<string>; onTap: (routine: Routine, button: HTMLElement) => void }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {list.map((routine) => (
        <li key={routine.id}>
          <RoutineTile routine={routine} color={profile.color} done={done.has(routine.id)} onTap={(button) => onTap(routine, button)} />
        </li>
      ))}
    </ul>
  );
}

// What one Profile's column shows for the part of the day (or every part): the part's heading with its Done mark, its tiles, what is
// left from earlier and the Routines for any time, or, on the whole day, every Routine under its part. The phone's card draws the same.
// `view` is partView for the part, null on the whole day, and `finished` whether the Profile has done everything today.
export function PartGroups({
  profile,
  routines,
  done,
  part,
  view,
  finished,
  onTap,
}: {
  profile: Profile;
  routines: Routine[];
  done: ReadonlySet<string>;
  part: ChartPart;
  view: PartView | null;
  finished: boolean;
  onTap: (routine: Routine, button: HTMLElement) => void;
}) {
  const tiles = (list: Routine[]) => <Tiles list={list} profile={profile} done={done} onTap={onTap} />;
  if (view === null || part === 'whole') {
    return groupByTimeOfDay(routines).map((group) => (
      <Fragment key={group.label}>
        <GroupLabel icon={group.value === null ? undefined : PART_ICON[group.value]}>{group.label}</GroupLabel>
        {tiles(group.routines)}
      </Fragment>
    ));
  }
  return (
    <>
      <GroupLabel
        icon={PART_ICON[part]}
        // Keyed by the part: a part already done is not announced when it is switched to, only a tick that makes it so is.
        // And a finished day is announced once, by the heading ("Ben: All done"): this stays on the page, for the eye, and says
        // nothing more to a screen reader then.
        status={
          <span key={part} role="status" className="flex items-center gap-1.5 text-[14.5px] leading-[18px] font-semibold">
            {partDone(view, done) && (
              <>
                {!finished && (
                  <span className="sr-only">
                    {profile.name}: {timeWord(part)}{' '}
                  </span>
                )}
                <span aria-hidden={finished || undefined} className="flex items-center gap-1.5">
                  <Tick size={20} color={profile.color} strong />
                  Done
                </span>
              </>
            )}
          </span>
        }
      >
        {timeWord(part)}
      </GroupLabel>
      {view.own.length > 0 && tiles(view.own)}
      {view.earlier.length > 0 && (
        <>
          <GroupLabel>Left from earlier</GroupLabel>
          {tiles(view.earlier)}
        </>
      )}
      {view.anytime.length > 0 && (
        <>
          <GroupLabel>Any time</GroupLabel>
          {tiles(view.anytime)}
        </>
      )}
      {view.own.length + view.earlier.length + view.anytime.length === 0 && <EmptyWords className="px-1">Nothing this {part}.</EmptyWords>}
    </>
  );
}

// The foot line under a column: how many Routines of earlier parts are done, with a tick for each of the first three. Nothing when none.
export function DoneEarlier({ view, color }: { view: PartView; color: string }) {
  if (view.doneEarlier === 0) return null;
  return (
    <div className="mt-1 flex h-6 flex-none items-center gap-2">
      <span aria-hidden className="flex gap-1">
        {Array.from({ length: Math.min(view.doneEarlier, 3) }, (_, index) => (
          <Tick key={index} size={20} color={color} strong />
        ))}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm leading-[1.2857] text-muted-foreground">{view.doneEarlier} done earlier today</span>
    </div>
  );
}

// What a screen decides about the frame it puts a Profile's Routines in: the classes of the section, the least height of the header
// row, and the size of the person's disc. Everything else is the same on the Wall and the phone.
export type ColumnLayout = { className: string; header: string; disc: number };

// One Profile's Routines: its disc, name and how far it is today, its pips, then the part of the day that is showing (or every
// part), then the foot line for what was done earlier. A tap on a tile ticks or unticks the Routine and, when it finishes the Profile,
// starts the burst where the tile is (tapRoutine), measured from this section, which the burst is drawn over. A Profile with nothing
// today has the column and says so. `tilesIn` puts the tiles in a box of the screen's own (the Wall's scrolls); without it they are
// the section's own children.
export function RoutineColumn({
  profile,
  routines,
  done,
  part,
  held,
  problem,
  onToggle,
  burst,
  onFinish,
  onLand,
  layout,
  tilesIn,
}: {
  profile: Profile;
  routines: Routine[];
  done: Set<string>;
  part: ChartPart;
  held: ReadonlySet<string>;
  // What the last tick of this Profile's that did not save says; empty when it was saved.
  problem: string | undefined;
  onToggle: (routine: Routine) => Promise<boolean>;
  // Set while a burst plays over this column.
  burst: Burst | undefined;
  // A tap on a Routine here finished the Profile, `at` px down the column; the burst's last piece has landed.
  onFinish: (at: number) => void;
  onLand: (id: number) => void;
  layout: ColumnLayout;
  tilesIn?: (tiles: ReactNode) => ReactNode;
}) {
  const { done: count, total } = routineProgress(routines, done);
  const finished = total > 0 && count === total;
  // With more Routines than pips, the count is all that says how far along they are, so it is read out.
  const pips = total > 0 && total <= MAX_PIPS;
  const view = part === 'whole' ? null : partView(routines, done, part, held);
  const frame = useRef<HTMLElement>(null);

  const tiles = (
    <PartGroups
      profile={profile}
      routines={routines}
      done={done}
      part={part}
      view={view}
      finished={finished}
      onTap={(routine, button) => tapRoutine({ routines, done, routine, button, frame: frame.current, onToggle, onFinish })}
    />
  );

  return (
    <section ref={frame} aria-labelledby={`routines-${profile.id}`} className={layout.className} style={personStyle(profile.color)}>
      <div className={cn('flex flex-none items-center gap-3', layout.header)}>
        <PersonDisc name={profile.name} color={profile.color} size={layout.disc} />
        <div className="flex min-w-0 flex-col gap-0.5">
          {/* A name is words too (WORDS): too long for the line it is hyphenated or broken, in two lines at most and then cut with an ellipsis, so
              no letter is cut with nothing to show it. The heading is the whole name, which is what the column is labelled by. */}
          <h3 id={`routines-${profile.id}`} dir="auto" className={cn(WORDS, 'line-clamp-2 font-display text-[26px] leading-[30px]')}>
            {profile.name}
          </h3>
          <div className="flex items-center gap-1.5 text-[15px] leading-5">
            {total === 0 && <span className="text-muted-foreground">Nothing today</span>}
            {total > 0 && !finished && (
              <span aria-hidden={pips || undefined} className="text-muted-foreground">
                {count} of {total} done
              </span>
            )}
            {/* Always on the page, so a screen reader hears "All done" when it appears and not when Routines load already done, and
                whose it is, because it is heard from wherever the screen reader is. */}
            <span role="status" className="flex items-center gap-1.5 font-semibold">
              {finished && (
                <>
                  <span className="sr-only">{profile.name}: </span>
                  <Star aria-hidden className="size-4 shrink-0" />
                  All done
                </>
              )}
            </span>
          </div>
        </div>
      </div>
      <Pips done={count} total={total} label={`${profile.name}: ${count} of ${total} ${total === 1 ? 'routine' : 'routines'} done`} color={profile.color} height={10} />
      {total > 0 && (tilesIn ? tilesIn(tiles) : tiles)}
      {view !== null && <DoneEarlier view={view} color={profile.color} />}
      {problem && (
        <p role="alert" className="flex-none px-1 text-[15px] leading-5">
          {problem}
        </p>
      )}
      {burst !== undefined && <Confetti key={burst.id} at={burst.at} onDone={() => onLand(burst.id)} />}
    </section>
  );
}
