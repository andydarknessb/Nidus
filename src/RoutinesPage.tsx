import { cn } from 'cn';
import { ArrowDown, ArrowUp, Star, type LucideIcon } from 'lucide-react';
import { Fragment, useCallback, useEffect, useId, useRef, useState, type CSSProperties, type FormEvent, type ReactNode, type Ref } from 'react';
import { EmptyWords } from './components/EmptyWords';
import { FOOT_CLEARANCE, OverflowButton } from './components/OverflowButton';
import { EmptyRing, MAX_PIPS, PersonDisc, Pips, Tick } from './components/people';
import { Problem } from './components/phone';
import { Button } from './components/ui/button';
import type { Household } from './lib/household';
import { PROFILE_PALETTE, loadProfiles, nextSortOrder, type Profile } from './lib/profiles';
import {
  ROUTINE_TABLES,
  TIME_OF_DAY_GROUPS,
  WEEKDAYS,
  archiveRoutine,
  createRoutine,
  groupByTimeOfDay,
  loadRoutines,
  maskOf,
  movedIdsInGroup,
  partDone,
  partView,
  reorderRoutines,
  routineProgress,
  showsTimeOfDayHeadings,
  tapFinishesProfile,
  updateRoutine,
  isScheduledOn,
  type Burst,
  type PartView,
  type ChartPart,
  type Routine,
  type RoutineEdit,
  type TimeOfDay,
} from './lib/routines';
import { PictureField, RoutinePicture } from './lib/routine-pictures';
import { useRefetchOn } from './lib/change-feed';
import { personStyle } from './lib/look';
import { supabase } from './lib/supabase';
import { CHART_CHOICES, PART_ICON, WORDS, timeWord, useChartPart } from './lib/routine-chart';
import { useOverflow } from './lib/use-overflow';
import { useCelebration, type RoutinesToday } from './lib/use-routines-today';
import { unnamed } from './lib/write-failure';

// ---- The wall: the Routines chart, and the tile that Up next shares --------------------------------

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

// One Profile's column of the chart: its disc, name and how far it is today, then the part of the day that is showing
// (or every part), then the foot line for what was done earlier. It is as tall as what it holds, and the tiles scroll on
// their own when they do not fit, with a "More" button at their foot that says so (OverflowButton). A Profile with nothing
// today has the column and says so.
function Column({
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
}) {
  const { done: count, total } = routineProgress(routines, done);
  const finished = total > 0 && count === total;
  // With more Routines than pips, the count is all that says how far along they are, so it is read out.
  const pips = total > 0 && total <= MAX_PIPS;
  const view = part === 'whole' ? null : partView(routines, done, part, held);
  const column = useRef<HTMLElement>(null);
  // Whether the tiles hold more than the column shows. The button is the tiles' last child, stuck to their foot, so a tick, a part
  // or a person coming and going is a render of this column and reads it again.
  const more = useOverflow('y', 'over');

  function tap(routine: Routine, button: HTMLElement) {
    if (column.current && tapFinishesProfile(routines, done, routine.id, !done.has(routine.id))) {
      // Where the burst starts: the middle of the button, measured from the column's padding edge, which is the burst's own top.
      const box = button.getBoundingClientRect();
      const top = column.current.getBoundingClientRect().top + column.current.clientTop;
      onFinish(box.top + box.height / 2 - top);
    }
    void onToggle(routine);
  }

  return (
    <section
      ref={column}
      aria-labelledby={`routines-${profile.id}`}
      className="person relative flex max-h-full min-h-0 max-w-md min-w-[17rem] flex-1 flex-col gap-2.5 rounded-3xl bg-person-soft p-3"
      style={personStyle(profile.color)}
    >
      <div className="flex min-h-14 flex-none items-center gap-3">
        <PersonDisc name={profile.name} color={profile.color} size={56} />
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
      {total > 0 && (
        // The scrolling box has no padding, so the "More" button at its foot sticks flush with its end; the padding inside it is room for
        // a tile's focus ring, which the box would otherwise clip. At rest a tile may sit partly under the button; one that takes the
        // keyboard's focus is scrolled clear of it.
        <div ref={more.scroller} className={cn('-m-1 min-h-0 overflow-y-auto', FOOT_CLEARANCE)}>
          <div className="flex flex-col gap-2.5 p-1">
            <PartGroups profile={profile} routines={routines} done={done} part={part} view={view} finished={finished} onTap={tap} />
          </div>
          {/* The tiles are 4 px in from the box, so the button is. */}
          <OverflowButton control={more} of={`${profile.name}'s routines`} surface="person" className="px-1" />
        </div>
      )}
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

// The Routines chart, a screen of its own: a control for the part of the day and a column for each Profile that has a
// Routine on any day, side by side in the Profiles' order. It opens on the part it is now, and moves to a new part when
// that part begins; a part picked by hand holds until then. Only when there are more Profiles than fit at a readable
// width does the row scroll sideways, and the heading row then holds a "More people" button that says so.
export function RoutinesChart({ routines }: { routines: RoutinesToday }) {
  const { loaded, failed, problems, columns, done, toggle } = routines;
  const celebration = useCelebration(routines);
  // The row of columns, and whether it holds more than it shows. The button is in the heading row, so it takes nothing from the row.
  const row = useOverflow('x');
  // Focus goes to the page's title on arrival, as on the calendar pages, rather than staying on the navigation rail.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  const { shown, held, pick } = useChartPart(routines);

  return (
    <section aria-labelledby="routines-chart-title" className="flex min-h-0 flex-col gap-4">
      {/* The heading row is 48 px, as on every screen, and the first card is 16 px under it. */}
      <div className="flex min-h-12 flex-none flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id="routines-chart-title" ref={heading} tabIndex={-1} className="font-display text-[28px] leading-[34px] outline-none">
          Routines
        </h2>
        <div className="flex max-w-full flex-none flex-wrap items-center gap-x-4 gap-y-2">
          {/* The choices are 8 px apart (docs/look.md, Touch), each at least 48 px both ways: the control is as tall as one of them. At larger text
              the heading row and the control wrap rather than run past the edge of the screen. */}
          <div role="group" aria-label="Part of the day" className="flex min-h-12 max-w-full flex-none flex-wrap gap-2 rounded-[18px] bg-card">
            {CHART_CHOICES.map(({ part, label, icon: Icon }) => (
              <Button
                key={part}
                variant="quiet"
                aria-pressed={shown === part}
                onClick={() => pick(part)}
                className="h-12 min-w-12 gap-2 rounded-[18px] px-4 text-[15px] font-medium"
              >
                {Icon && <Icon aria-hidden className="size-5" />}
                {label}
              </Button>
            ))}
          </div>
          {/* More columns than fit is not a screen with fewer people on it: this says there are more, and moves on to them. */}
          <OverflowButton control={row} of="people" className="h-12" />
        </div>
      </div>
      {!loaded && !failed && <EmptyWords>Loading</EmptyWords>}
      {/* Once Routines have been read, a lost connection keeps them on screen and the header says so. */}
      {failed && !loaded && (
        <p role="alert" className="text-base">
          Could not load routines. Check your connection.
        </p>
      )}
      {loaded && columns.length === 0 && <EmptyWords>No routines yet. The owner adds them in Settings.</EmptyWords>}
      <div ref={row.scroller} className="flex min-h-0 flex-1 items-start gap-3 overflow-x-auto">
        {columns.map(({ profile, routines: today }) => (
          <Column
            key={profile.id}
            profile={profile}
            routines={today}
            done={done}
            part={shown}
            held={held}
            problem={problems[profile.id]}
            onToggle={toggle}
            burst={celebration.bursts[profile.id]}
            onFinish={(at) => celebration.start(profile.id, at)}
            onLand={(id) => celebration.land(profile.id, id)}
          />
        ))}
      </div>
    </section>
  );
}

// ---- The phone: manage Routines per Profile (Household Account only) ------------------

const allDays = maskOf(WEEKDAYS.map((weekday) => weekday.bit));

// The days, then the time of day when the Routine has one: "Mon, Tue · Morning". Non-breaking
// spaces keep a wrapped line from ending on the dot.
function scheduleSummary(mask: number, timeOfDay: TimeOfDay | null): string {
  const days =
    mask === allDays
      ? 'Every day'
      : WEEKDAYS.filter((weekday) => isScheduledOn(mask, weekday.bit))
          .map((weekday) => weekday.short)
          .join(', ');
  const time = timeWord(timeOfDay);
  return time ? `${days}\u00a0·\u00a0${time}` : days;
}

// What a Routine's buttons are called: its title, then its time of day when it has one, so two
// Routines with one title (Brush teeth in the morning and again in the evening) can be told apart.
function routineName(routine: Routine): string {
  const time = timeWord(routine.time_of_day);
  return time ? `${routine.title}, ${time}` : routine.title;
}

// Monday first on screen; the bits stay Sunday = 0.
const weekOrder = [...WEEKDAYS.slice(1), WEEKDAYS[0]];

// The Time of day choices as the select lists them: Any time, the default, first.
const timeOfDayChoices = [...TIME_OF_DAY_GROUPS.slice(-1), ...TIME_OF_DAY_GROUPS.slice(0, -1)];

// One form for adding a Routine and for editing one: a title, the days, a time of day and a picture.
// Given a Routine it starts from that Routine and offers Cancel; without one it starts blank
// and, once the Routine is added, blank again. A save asked for with no title says so in the form's own line
// ("Give the routine a name."), and the browser's own bubble for the empty field is off (noValidate).
export function RoutineForm({
  profile,
  routine,
  onSave,
  onCancel,
}: {
  profile: Profile;
  routine?: Routine;
  onSave: (input: RoutineEdit) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [title, setTitle] = useState(routine?.title ?? '');
  const [mask, setMask] = useState(routine?.days_of_week ?? allDays);
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay | null>(routine?.time_of_day ?? null);
  const [picture, setPicture] = useState<string | null>(routine?.picture ?? null);
  // Saving is true while a save is in flight, so a second tap cannot send it twice. Failed says the
  // last one did not go through: the form stays open with what was typed, and says so beside Save.
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  // How many times a save was asked for with no title, and what that says while there is still none.
  const [asked, setAsked] = useState(0);
  const unnamedWords = unnamed('routine', asked, title);
  const nameProblem = useId();
  // How many Routines this form has added. The picture grid keeps its own open state, so it is keyed by this and starts closed
  // again with the rest of the form.
  const [added, setAdded] = useState(0);
  // What the labels name, so no two forms on the page share a label.
  const about = routine ? routine.title : `${profile.name}'s new routine`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mask === 0 || saving) return;
    if (!title.trim()) {
      setAsked((count) => count + 1);
      return;
    }
    setSaving(true);
    setFailed(false);
    const saved = await onSave({ title, days_of_week: mask, time_of_day: timeOfDay, picture });
    setSaving(false);
    setFailed(!saved);
    if (saved && !routine) {
      setTitle('');
      setAsked(0);
      setMask(allDays);
      setTimeOfDay(null);
      setPicture(null);
      setAdded((count) => count + 1);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
      <label className="flex flex-col gap-2 text-[15px] text-muted-foreground">
        {routine ? `Title for ${routine.title}` : `New routine for ${profile.name}`}
        <input
          className="w-full text-[17px] text-foreground"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={100}
          required
          aria-invalid={unnamedWords ? true : undefined}
          aria-describedby={unnamedWords ? nameProblem : undefined}
          autoFocus={routine !== undefined}
        />
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-[15px] text-muted-foreground">Days for {about}</legend>
        <div className="flex flex-wrap gap-2">
          {weekOrder.map((weekday) => {
            const on = isScheduledOn(mask, weekday.bit);
            return (
              <Button
                key={weekday.bit}
                variant="secondary"
                aria-pressed={on}
                aria-label={weekday.name}
                onClick={() => setMask(on ? mask & ~(1 << weekday.bit) : mask | (1 << weekday.bit))}
                className="h-12 min-w-12 rounded-2xl px-3 font-medium"
              >
                {weekday.short}
              </Button>
            );
          })}
        </div>
      </fieldset>
      <label className="flex flex-col gap-2 text-[15px] text-muted-foreground">
        Time of day for {about}
        <select
          className="w-full text-[17px] text-foreground"
          value={timeOfDay ?? ''}
          onChange={(e) => setTimeOfDay(TIME_OF_DAY_GROUPS.find((group) => group.value === e.target.value)?.value ?? null)}
        >
          {timeOfDayChoices.map((option) => (
            <option key={option.label} value={option.value ?? ''}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <PictureField key={added} about={about} picture={picture} onChange={setPicture} />
      <div className="flex gap-3">
        {/* A page of forms has one primary: the Save of the Routine being edited. Adding is secondary. */}
        <Button type="submit" size="phone" variant={routine ? 'primary' : 'secondary'} className="flex-1" disabled={mask === 0 || saving}>
          {routine ? 'Save' : 'Add routine'}
        </Button>
        {onCancel && (
          <Button size="phone" variant="quiet" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      <Problem id={nameProblem} problem={unnamedWords} />
      {failed && (
        <p role="alert" className="text-base">
          Could not {routine ? 'save' : 'add'} that routine. Check the name and days, then try again.
        </p>
      )}
      {mask === 0 && <p className="text-base">Pick at least one day.</p>}
    </form>
  );
}

export function RoutinesPage({ household }: { household: Household }) {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [problem, setProblem] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  // Which Routine's form is open right now. A save that finishes late looks here, not at the render it began in.
  const editingNow = useRef<string | null>(null);
  const [focusNext, setFocusNext] = useState<string | null>(null);

  // Moves focus once the element it names is on screen; the swap unmounts whatever had it.
  useEffect(() => {
    if (focusNext === null) return;
    document.getElementById(focusNext)?.focus();
    setFocusNext(null);
  }, [focusNext]);

  const refresh = useCallback(async () => {
    try {
      const [foundProfiles, foundRoutines] = await Promise.all([loadProfiles(supabase), loadRoutines(supabase)]);
      setProfiles(foundProfiles);
      setRoutines(foundRoutines);
    } catch {
      setProblem('Could not load routines. Check your connection.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useRefetchOn(ROUTINE_TABLES, () => void refresh());

  // Runs one change, then reloads so the screen shows what the database holds. A failure is said in
  // the status line; a form that says so itself, beside its Save, passes no failure.
  async function change(work: () => Promise<void>, failure = ''): Promise<boolean> {
    let ok = true;
    try {
      await work();
      setProblem('');
    } catch {
      setProblem(failure);
      ok = false;
    }
    await refresh();
    return ok;
  }

  function startEditing(id: string) {
    editingNow.current = id;
    setEditing(id);
  }

  // Save and Cancel both end on the row's Edit button, which the swap back has just put on screen,
  // but only while the form open is still this Routine's: a save that finishes late must not close
  // the form of a Routine opened since, or take its focus.
  function stopEditing(id: string) {
    if (editingNow.current !== id) return;
    editingNow.current = null;
    setEditing(null);
    setFocusNext(`edit-${id}`);
  }

  // A failed save keeps the form open, with what was typed; the form says so itself.
  async function save(id: string, input: RoutineEdit): Promise<boolean> {
    const ok = await change(() => updateRoutine(supabase, id, input));
    if (ok) stopEditing(id);
    return ok;
  }

  const ofProfile = (profileId: string) => routines.filter((routine) => routine.profile_id === profileId);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 pt-2 pb-6">
      <h1 className="sr-only">Routines</h1>
      {/* On the page from the first draw, so a screen reader hears a sentence when it comes, and out of the layout while it has none: the first card starts where the Lists page's does. */}
      <p role="status" className="text-base empty:sr-only">
        {problem}
      </p>
      {profiles?.length === 0 && (
        <p className="text-base">
          <a href="/settings" className="underline">Add a person first</a>. Routines belong to a person.
        </p>
      )}

      {profiles?.map((profile) => {
        const own = ofProfile(profile.id);
        // The groups, their order and the heading rule are the Wall's, so the phone never lists an order the Wall does not show.
        const times = groupByTimeOfDay(own);
        const headed = showsTimeOfDayHeadings(own);
        return (
          <section
            key={profile.id}
            aria-labelledby={`profile-${profile.id}`}
            className="person flex flex-col gap-4 rounded-3xl bg-card p-4"
            style={personStyle(profile.color)}
          >
            <h2 id={`profile-${profile.id}`} tabIndex={-1} className="flex items-center gap-3 font-display text-[22px] leading-7 outline-none">
              <PersonDisc name={profile.name} color={profile.color} size={44} />
              {profile.name}
            </h2>
            {own.length === 0 && <p className="text-base">No routines yet.</p>}
            {times.map((time) => (
              <Fragment key={time.label}>
                {headed && <h3 className="text-sm font-medium text-muted-foreground">{time.label}</h3>}
                <ul className="flex flex-col gap-2">
                  {time.routines.map((routine, index) => (
                    <li key={routine.id} className={cn('flex flex-col gap-2', editing !== routine.id && 'rounded-[14px] bg-muted p-3')}>
                      {editing === routine.id ? (
                        <RoutineForm profile={profile} routine={routine} onSave={(input) => save(routine.id, input)} onCancel={() => stopEditing(routine.id)} />
                      ) : (
                        <>
                          <div className="flex items-center gap-3">
                            <span aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-full bg-person-fill text-person-strong">
                              <RoutinePicture picture={routine.picture} size={26} />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-[17px] leading-6 font-medium break-words">{routine.title}</p>
                              <p className="text-sm leading-[1.2857] text-muted-foreground">{scheduleSummary(routine.days_of_week, routine.time_of_day)}</p>
                            </div>
                          </div>
                          {confirming === routine.id ? (
                            <div className="flex gap-2">
                              <Button
                                autoFocus
                                variant="delete"
                                aria-label={`Archive ${routineName(routine)}`}
                                className="h-12 flex-1 rounded-[14px]"
                                onClick={() => {
                                  setConfirming(null);
                                  setFocusNext(`profile-${profile.id}`);
                                  void change(() => archiveRoutine(supabase, routine.id), 'Could not archive that routine. Try again.');
                                }}
                              >
                                Archive {routine.title}
                              </Button>
                              <Button
                                variant="quiet"
                                className="h-12 rounded-[14px]"
                                onClick={() => {
                                  setConfirming(null);
                                  setFocusNext(`archive-${routine.id}`);
                                }}
                              >
                                Keep it
                              </Button>
                            </div>
                          ) : (
                            <div className="flex gap-2">
                              <Button
                                id={`edit-${routine.id}`}
                                variant="quiet"
                                className="h-12 flex-1 rounded-[14px]"
                                aria-label={`Edit ${routineName(routine)}`}
                                onClick={() => startEditing(routine.id)}
                              >
                                Edit
                              </Button>
                              <Button
                                id={`archive-${routine.id}`}
                                variant="quiet"
                                className="h-12 flex-1 rounded-[14px]"
                                aria-label={`Archive ${routineName(routine)}`}
                                onClick={() => setConfirming(routine.id)}
                              >
                                Archive
                              </Button>
                              <Button
                                variant="quiet"
                                className="size-12 rounded-full p-0"
                                aria-label={`Move ${routineName(routine)} up`}
                                disabled={index === 0}
                                onClick={() =>
                                  void change(() => reorderRoutines(supabase, movedIdsInGroup(own, routine.id, -1)), 'Could not reorder routines. Try again.')
                                }
                              >
                                <ArrowUp aria-hidden className="size-5" />
                              </Button>
                              <Button
                                variant="quiet"
                                className="size-12 rounded-full p-0"
                                aria-label={`Move ${routineName(routine)} down`}
                                disabled={index === time.routines.length - 1}
                                onClick={() =>
                                  void change(() => reorderRoutines(supabase, movedIdsInGroup(own, routine.id, 1)), 'Could not reorder routines. Try again.')
                                }
                              >
                                <ArrowDown aria-hidden className="size-5" />
                              </Button>
                            </div>
                          )}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </Fragment>
            ))}
            <div className={own.length > 0 ? 'border-t border-border pt-4' : undefined}>
              <RoutineForm
                profile={profile}
                onSave={(input) => change(() => createRoutine(supabase, household.id, profile.id, input, nextSortOrder(own)).then(() => undefined))}
              />
            </div>
          </section>
        );
      })}
    </main>
  );
}
