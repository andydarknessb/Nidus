import { cn } from 'cn';
import { ArrowDown, ArrowUp, Moon, Star, Sun, Sunrise, type LucideIcon } from 'lucide-react';
import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode, type Ref } from 'react';
import { FOOT_CLEARANCE, OverflowButton } from './components/OverflowButton';
import { EmptyRing, MAX_PIPS, PersonDisc, Pips, Tick } from './components/people';
import { Button } from './components/ui/button';
import type { Household } from './lib/household';
import { PROFILE_PALETTE, loadProfiles, nextSortOrder, type Profile } from './lib/profiles';
import {
  ROUTINE_TABLES,
  TIME_OF_DAY_GROUPS,
  WEEKDAYS,
  archiveRoutine,
  createRoutine,
  followClock,
  groupByTimeOfDay,
  holdShown,
  loadRoutines,
  maskOf,
  movedIdsInGroup,
  openChart,
  partDone,
  partView,
  pickPart,
  reorderRoutines,
  routineProgress,
  showsTimeOfDayHeadings,
  tapFinishesProfile,
  updateRoutine,
  isScheduledOn,
  type Burst,
  type ChartPart,
  type Routine,
  type RoutineEdit,
  type TimeOfDay,
} from './lib/routines';
import { PictureField, RoutinePicture } from './lib/routine-pictures';
import { useRefetchOn } from './lib/change-feed';
import { personStyle } from './lib/look';
import { supabase } from './lib/supabase';
import { useOverflow } from './lib/use-overflow';
import { useCelebration, type RoutinesToday } from './lib/use-routines-today';

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

// The words of a tile, whatever they are. A word too long for its line is hyphenated (the page says lang="en") or, where that
// cannot be done, broken onto the next line, and what is past the last line ends in an ellipsis: no letter is ever cut with
// nothing to show it. `dir="auto"` on the element sets the direction from the words, so a right-to-left title starts at the
// right and, when it is cut, is cut at its end; `text-start` follows that direction.
const WORDS = 'min-w-0 text-start break-words hyphens-auto';

// A Routine's tile (docs/look.md, A Routine tile): the whole tile is the button, 80 px tall, with the picture in a 52 px disc,
// the words on up to two lines and a 44 px ring. To do, the ring is the person's strong colour; done, the tile is filled
// with their base colour and shows a tick, and its words stay as they are, not struck through. On the chart it is a card
// on the person's column and says whether it is ticked. In Up next, which names the person under the words (`who`), it is
// a tile on a card; a Routine ticked there stays in the done look for a moment (HOME_HOLD_MS), and tapped then it is unticked.
export function RoutineTile({
  routine,
  color,
  done = false,
  who,
  ref,
  onTap,
}: {
  routine: Routine;
  color: string;
  done?: boolean;
  who?: string;
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
        className={cn('flex size-13 shrink-0 items-center justify-center rounded-full', done ? 'bg-person-done-disc text-person-done-picture' : 'bg-person-fill text-person-strong')}
      >
        <RoutinePicture picture={routine.picture} />
      </span>
      {who === undefined ? (
        <span dir="auto" className={cn(WORDS, 'line-clamp-2 flex-1 text-[19px] leading-[1.2]', done ? 'font-semibold' : 'font-medium')}>
          {routine.title}
        </span>
      ) : (
        <span className="flex min-w-0 flex-1 flex-col">
          <span dir="auto" className={cn(WORDS, 'line-clamp-2 text-[19px] leading-6', done ? 'font-semibold' : 'font-medium')}>
            {routine.title}
          </span>
          <span dir="auto" className={cn('truncate text-start text-sm leading-[18px]', !done && 'text-muted-foreground')}>
            {who}
          </span>
        </span>
      )}
      {done ? <Tick color={color} /> : <EmptyRing color={color} />}
    </button>
  );
}

// The icon each part of the day has on the chart's control and over a column.
const PART_ICON: Record<TimeOfDay, LucideIcon> = { morning: Sunrise, afternoon: Sun, evening: Moon };

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

  const tiles = (list: Routine[]) => (
    <ul className="flex flex-col gap-2.5">
      {list.map((routine) => (
        <li key={routine.id}>
          <RoutineTile routine={routine} color={profile.color} done={done.has(routine.id)} onTap={(button) => tap(routine, button)} />
        </li>
      ))}
    </ul>
  );

  return (
    <section
      ref={column}
      aria-labelledby={`routines-${profile.id}`}
      className="person relative flex max-h-full min-h-0 max-w-md min-w-[17rem] flex-1 flex-col gap-2.5 rounded-3xl bg-person-soft p-3.5"
      style={personStyle(profile.color)}
    >
      <div className="flex min-h-14 flex-none items-center gap-3">
        <PersonDisc name={profile.name} color={profile.color} size={56} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 id={`routines-${profile.id}`} className="font-display text-[26px] leading-[30px] break-words">
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
      <Pips done={count} total={total} label={`${profile.name}: ${count} of ${total} ${total === 1 ? 'Routine' : 'Routines'} done`} color={profile.color} height={10} />
      {total > 0 && (
        // The scrolling box has no padding, so the "More" button at its foot sticks flush with its end; the padding inside it is room for
        // a tile's focus ring, which the box would otherwise clip. At rest a tile may sit partly under the button; one that takes the
        // keyboard's focus is scrolled clear of it.
        <div ref={more.scroller} className={cn('-m-1 min-h-0 overflow-y-auto', FOOT_CLEARANCE)}>
          <div className="flex flex-col gap-2.5 p-1">
            {view === null
              ? groupByTimeOfDay(routines).map((group) => (
                  <Fragment key={group.label}>
                    <GroupLabel icon={group.value === null ? undefined : PART_ICON[group.value]}>{group.label}</GroupLabel>
                    {tiles(group.routines)}
                  </Fragment>
                ))
              : part !== 'whole' && (
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
                    {view.own.length + view.earlier.length + view.anytime.length === 0 && <p className="px-1 text-[15px] text-muted-foreground">Nothing this {part}.</p>}
                  </>
                )}
          </div>
          {/* The tiles are 4 px in from the box, so the button is. */}
          <OverflowButton control={more} of={`${profile.name}'s routines`} surface="person" className="px-1" />
        </div>
      )}
      {view !== null && view.doneEarlier > 0 && (
        <div className="mt-1 flex h-6 flex-none items-center gap-2">
          <span aria-hidden className="flex gap-1">
            {Array.from({ length: Math.min(view.doneEarlier, 3) }, (_, index) => (
              <Tick key={index} size={20} color={profile.color} strong />
            ))}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm leading-[18px] text-muted-foreground">{view.doneEarlier} done earlier today</span>
        </div>
      )}
      {problem && (
        <p role="alert" className="flex-none px-1 text-[15px] leading-5">
          {problem}
        </p>
      )}
      {burst !== undefined && <Confetti key={burst.id} at={burst.at} onDone={() => onLand(burst.id)} />}
    </section>
  );
}

// The words and icon on the chart's control, one choice for each part of the day and one for all of it.
const CHART_CHOICES: { part: ChartPart; label: string; icon?: LucideIcon }[] = [
  { part: 'morning', label: 'Morning', icon: Sunrise },
  { part: 'afternoon', label: 'Afternoon', icon: Sun },
  { part: 'evening', label: 'Evening', icon: Moon },
  { part: 'whole', label: 'Whole day' },
];

// The Routines chart, a screen of its own: a control for the part of the day and a column for each Profile that has a
// Routine on any day, side by side in the Profiles' order. It opens on the part it is now, and moves to a new part when
// that part begins; a part picked by hand holds until then. Only when there are more Profiles than fit at a readable
// width does the row scroll sideways, and the heading row then holds a "More people" button that says so.
export function RoutinesChart({ routines }: { routines: RoutinesToday }) {
  const { loaded, settled, failed, part: clock, problems, columns, done, toggle } = routines;
  const celebration = useCelebration(routines);
  // The row of columns, and whether it holds more than it shows. The button is in the heading row, so it takes nothing from the row.
  const row = useOverflow('x');
  // Focus goes to the page's title on arrival, as on the calendar pages, rather than staying on the navigation rail.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  // What the chart shows follows the clock, and keeps in place what it has shown as left from earlier, in this render, so
  // that not one frame of it is drawn with a Routine gone that was ticked a moment ago. See followClock and holdShown. What
  // is shown before the day's ticks have been read is not kept: it is not what is left.
  const [chart, setChart] = useState(() => openChart(clock));
  const followed = followClock(chart, clock);
  const shown = followed.part;
  const current = holdShown(
    followed,
    shown === 'whole' || !settled ? [] : columns.flatMap((column) => partView(column.routines, done, shown).earlier.map((routine) => routine.id)),
  );
  if (current !== chart) setChart(current);

  return (
    <section aria-labelledby="routines-chart-title" className="flex min-h-0 flex-col gap-3">
      <div className="flex h-14 flex-none items-center justify-between gap-4">
        <h2 id="routines-chart-title" ref={heading} tabIndex={-1} className="font-display text-[30px] leading-9 outline-none">
          Routines
        </h2>
        <div className="flex flex-none items-center gap-4">
          {/* The choices are 8 px apart (docs/look.md, Touch), each at least 48 px both ways. */}
          <div role="group" aria-label="Part of the day" className="flex h-14 flex-none gap-2 rounded-[18px] bg-card p-1">
            {CHART_CHOICES.map(({ part, label, icon: Icon }) => (
              <Button
                key={part}
                variant="quiet"
                aria-pressed={shown === part}
                onClick={() => setChart(pickPart(current, part))}
                className="h-12 gap-2 rounded-[14px] px-4 text-[15px] font-medium"
              >
                {Icon && <Icon aria-hidden className="size-5" />}
                {label}
              </Button>
            ))}
          </div>
          {/* More columns than fit is not a screen with fewer people on it: this says there are more, and moves on to them. */}
          <OverflowButton control={row} of="people" />
        </div>
      </div>
      {!loaded && !failed && <p className="text-base">Loading</p>}
      {/* Once Routines have been read, a lost connection keeps them on screen and the header says so. */}
      {failed && !loaded && (
        <p role="alert" className="text-base">
          Could not load Routines. Check your connection.
        </p>
      )}
      {loaded && columns.length === 0 && <p className="text-base">No Routines yet.</p>}
      <div ref={row.scroller} className="flex min-h-0 flex-1 items-start gap-3 overflow-x-auto">
        {columns.map(({ profile, routines: today }) => (
          <Column
            key={profile.id}
            profile={profile}
            routines={today}
            done={done}
            part={shown}
            held={current.held}
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

// The word for a time of day. Any time has none: it is the absence of one.
function timeWord(timeOfDay: TimeOfDay | null): string | undefined {
  return TIME_OF_DAY_GROUPS.find((group) => group.value !== null && group.value === timeOfDay)?.label;
}

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
// and, once the Routine is added, blank again.
function RoutineForm({
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
  // How many Routines this form has added. The picture grid keeps its own open state, so it is keyed by this and starts closed
  // again with the rest of the form.
  const [added, setAdded] = useState(0);
  // What the labels name, so no two forms on the page share a label.
  const about = routine ? routine.title : `${profile.name}'s new Routine`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || mask === 0 || saving) return;
    setSaving(true);
    setFailed(false);
    const saved = await onSave({ title, days_of_week: mask, time_of_day: timeOfDay, picture });
    setSaving(false);
    setFailed(!saved);
    if (saved && !routine) {
      setTitle('');
      setMask(allDays);
      setTimeOfDay(null);
      setPicture(null);
      setAdded((count) => count + 1);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <label className="flex flex-col gap-2 text-[15px] text-muted-foreground">
        {routine ? `Title for ${routine.title}` : `New Routine for ${profile.name}`}
        <input
          className="w-full text-[17px] text-foreground"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={100}
          placeholder="Feed the dog"
          required
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
          {routine ? 'Save' : 'Add Routine'}
        </Button>
        {onCancel && (
          <Button size="phone" variant="quiet" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      {failed && (
        <p role="alert" className="text-base">
          Could not {routine ? 'save' : 'add'} that Routine. Check the name and days, then try again.
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
      setProblem('Could not load Routines. Check your connection.');
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
      <p role="status" className="min-h-6 text-base">
        {problem}
      </p>
      {profiles?.length === 0 && (
        <p className="text-base">
          Add a person first, in <a href="/settings" className="underline">Household settings</a>. Routines belong to a person.
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
            {own.length === 0 && <p className="text-base">No Routines yet.</p>}
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
                              <p className="text-sm leading-[18px] text-muted-foreground">{scheduleSummary(routine.days_of_week, routine.time_of_day)}</p>
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
                                  void change(() => archiveRoutine(supabase, routine.id), 'Could not archive that Routine. Try again.');
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
                                  void change(() => reorderRoutines(supabase, movedIdsInGroup(own, routine.id, -1)), 'Could not reorder Routines. Try again.')
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
                                  void change(() => reorderRoutines(supabase, movedIdsInGroup(own, routine.id, 1)), 'Could not reorder Routines. Try again.')
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
