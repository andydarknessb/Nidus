import { cn } from 'cn';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Fragment, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { EmptyWords } from './components/EmptyWords';
import { RoutineColumn, type ColumnLayout } from './components/RoutineColumn';
import { BODY_CLEARANCE, FOOT_CLEARANCE, OverflowButton } from './components/OverflowButton';
import { PersonDisc } from './components/people';
import { Problem } from './components/phone';
import { Button } from './components/ui/button';
import type { Household } from './lib/household';
import { nextSortOrder } from './lib/ordering';
import { loadProfiles, type Profile } from './lib/profiles';
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
  reorderRoutines,
  showsTimeOfDayHeadings,
  updateRoutine,
  isScheduledOn,
  type Burst,
  type ChartPart,
  type Routine,
  type RoutineEdit,
  type TimeOfDay,
} from './lib/routines';
import { PictureField, RoutinePicture } from './lib/routine-pictures';
import { useCardWrite } from './lib/use-card-write';
import { personStyle } from './lib/look';
import { supabase } from './lib/supabase';
import { CHART_CHOICES, timeWord, useChartPart } from './lib/routine-chart';
import { useOverflow } from './lib/use-overflow';
import { useCelebration, type RoutinesToday } from './lib/use-routines-today';
import { unnamed } from './lib/write-failure';
import { couldNotLoad, useSyncedRead } from './lib/synced-read';

// ---- The wall: the Routines chart ---------------------------------------------------------------------------------

// The Wall's layout for one Profile's column of the chart (the Routines are RoutineColumn's, shared with the phone's card): as tall as
// what it holds, and the tiles scroll on their own when they do not fit, with a "More" button at their foot that says so
// (OverflowButton).
const COLUMN: ColumnLayout = {
  className: 'person relative flex max-h-full min-h-0 max-w-md min-w-[17rem] flex-1 flex-col gap-2.5 rounded-3xl bg-person-soft p-3',
  header: 'min-h-14',
  disc: 56,
};

// In portrait (docs/specs/0009) the column is its natural height, with no foot of its own: the chart scrolls.
const PORTRAIT_COLUMN: ColumnLayout = { ...COLUMN, className: COLUMN.className.replace('max-h-full ', '') };

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
  portrait,
}: {
  profile: Profile;
  routines: Routine[];
  done: Set<string>;
  part: ChartPart;
  held: ReadonlySet<string>;
  problem: string | undefined;
  onToggle: (routine: Routine) => Promise<boolean>;
  burst: Burst | undefined;
  onFinish: (at: number) => void;
  onLand: (id: number) => void;
  portrait: boolean;
}) {
  // Whether the tiles hold more than the column shows. The button is the tiles' last child, stuck to their foot, so a tick, a part
  // or a person coming and going is a render of this column and reads it again.
  const more = useOverflow('y', 'over');
  return (
    <RoutineColumn
      profile={profile}
      routines={routines}
      done={done}
      part={part}
      held={held}
      problem={problem}
      onToggle={onToggle}
      burst={burst}
      onFinish={onFinish}
      onLand={onLand}
      layout={portrait ? PORTRAIT_COLUMN : COLUMN}
      tilesIn={(tiles) => (
        // The scrolling box has no padding, so the "More" button at its foot sticks flush with its end; the padding inside it is room for
        // a tile's focus ring, which the box would otherwise clip. At rest a tile may sit partly under the button; one that takes the
        // keyboard's focus is scrolled clear of it.
        <div ref={portrait ? undefined : more.scroller} className={portrait ? '-m-1' : cn('-m-1 min-h-0 overflow-y-auto', FOOT_CLEARANCE)}>
          <div className="flex flex-col gap-2.5 p-1">{tiles}</div>
          {/* The tiles are 4 px in from the box, so the button is. */}
          {!portrait && <OverflowButton control={more} of={`${profile.name}'s routines`} surface="person" className="px-1" />}
        </div>
      )}
    />
  );
}

// The Routines chart, a screen of its own: a control for the part of the day and a column for each Profile that has a
// Routine on any day, side by side in the Profiles' order. It opens on the part it is now, and moves to a new part when
// that part begins; a part picked by hand holds until then. Only when there are more Profiles than fit at a readable
// width does the row scroll sideways, and the heading row then holds a "More people" button that says so.
// `portrait` is the Wall's one read of the window (useHomeLayout, from the shell): a tablet hung upright (docs/specs/0009). The columns then
// sit in a grid, each its natural height, and the chart scrolls as one column with the shared "More" foot; there is no sideways "More".
export function RoutinesChart({ routines, portrait = false }: { routines: RoutinesToday; portrait?: boolean }) {
  const { loaded, failed, problems, columns, done, toggle } = routines;
  const celebration = useCelebration(routines);
  // The row of columns, and whether it holds more than it shows. The button is in the heading row, so it takes nothing from the row;
  // in portrait the box is the chart's column and the button is its foot.
  const row = useOverflow(portrait ? 'y' : 'x', portrait ? 'over' : undefined);
  // Focus goes to the page's title on arrival, as on the calendar pages, rather than staying on the navigation rail.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  const { shown, held, pick } = useChartPart(routines);

  const people = columns.map(({ profile, routines: today }) => (
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
      portrait={portrait}
    />
  ));

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
          {!portrait && <OverflowButton control={row} of="people" className="h-12" />}
        </div>
      </div>
      {!loaded && !failed && <EmptyWords>Loading</EmptyWords>}
      {/* Once Routines have been read, a lost connection keeps them on screen and the header says so. */}
      {failed && !loaded && (
        <p role="alert" className="text-base">
          {couldNotLoad('routines')}
        </p>
      )}
      {loaded && columns.length === 0 && <EmptyWords>No routines yet. The owner adds them in Settings.</EmptyWords>}
      {portrait ? (
        // The columns are a grid of columns at least 17 rem, as many to a row as fit, each its row-mates' width (and with fewer columns than fit, the columns share the row), 12 apart across and 16 under one
        // another, each its natural height; the chart scrolls as one column, and its foot is the shared button. A tile or field that takes the focus is scrolled clear of the foot.
        <div ref={row.scroller} className="min-h-0 flex-1 overflow-y-auto">
          <div className={cn('grid grid-cols-[repeat(auto-fit,minmax(min(17rem,100%),1fr))] items-start gap-x-3 gap-y-4', BODY_CLEARANCE)}>{people}</div>
          <OverflowButton control={row} of="the routines" />
        </div>
      ) : (
        <div ref={row.scroller} className="flex min-h-0 flex-1 items-start gap-3 overflow-x-auto">
          {/* The same wrapper as portrait's, so turning the tablet keeps each column (and its read) instead of mounting it again. */}
          <div className="contents">{people}</div>
        </div>
      )}
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
  busy = false,
  onSave,
  onCancel,
}: {
  profile: Profile;
  routine?: Routine;
  // Whether the page is making a change: Save does nothing and is drawn `aria-disabled`.
  busy?: boolean;
  // Whether the Routine was saved; undefined when the page was busy and did nothing, which is not a failure.
  onSave: (input: RoutineEdit) => Promise<boolean | undefined>;
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
    if (mask === 0 || saving || busy) return;
    if (!title.trim()) {
      setAsked((count) => count + 1);
      return;
    }
    setSaving(true);
    const saved = await onSave({ title, days_of_week: mask, time_of_day: timeOfDay, picture });
    setSaving(false);
    // Nothing was done (the page was busy): what the form said of the last save stands.
    if (saved === undefined) return;
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
        <Button type="submit" size="phone" variant={routine ? 'primary' : 'secondary'} className="flex-1" aria-disabled={mask === 0 || saving || busy || undefined}>
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

const NO_ROUTINES: Routine[] = [];

export function RoutinesPage({ household }: { household: Household }) {
  // Read through the synced read; a change is written through it, then read back before the page moves on.
  const read = useSyncedRead(
    async () => {
      const [profiles, routines] = await Promise.all([loadProfiles(supabase), loadRoutines(supabase)]);
      return { profiles, routines };
    },
    ROUTINE_TABLES,
    'routines',
  );
  const profiles = read.data?.profiles ?? null;
  const routines = read.data?.routines ?? NO_ROUTINES;
  // What the last change said when it failed, else that the page could not be read.
  const [changeProblem, setProblem] = useState('');
  const problem = changeProblem || (read.failed ? couldNotLoad('routines') : '');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  // Which Routine's form is open right now. A save that finishes late looks here, not at the render it began in.
  const editingNow = useRef<string | null>(null);
  // One change at a time (the card write guard): the buttons are drawn `aria-disabled` from `busy`, and focus goes where the page says.
  const card = useCardWrite();
  const { busy } = card;

  // Runs one change, then reads again so the screen shows what the database holds, before the next may begin. A failure is said in
  // the status line at once; a form that says so itself, beside its Save, passes no failure. Says whether it was made, and nothing
  // (undefined) when another change was on its way and this one did nothing. `landed` is what the page then does.
  async function change(work: () => Promise<void>, failure = '', landed?: () => void): Promise<boolean | undefined> {
    const outcome = await card.run(
      async () => {
        await read.write(work);
        setProblem('');
        await read.readBack();
      },
      { failed: () => setProblem(failure), landed },
    );
    return outcome === 'busy' ? undefined : outcome === 'done';
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
    card.focus(`edit-${id}`);
  }

  // A failed save keeps the form open, with what was typed; the form says so itself.
  async function save(id: string, input: RoutineEdit): Promise<boolean | undefined> {
    return change(() => updateRoutine(supabase, id, input), '', () => stopEditing(id));
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
                        <RoutineForm profile={profile} routine={routine} busy={busy} onSave={(input) => save(routine.id, input)} onCancel={() => stopEditing(routine.id)} />
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
                                aria-disabled={busy || undefined}
                                onClick={() => {
                                  if (card.isBusy()) return;
                                  setConfirming(null);
                                  card.focus(`profile-${profile.id}`);
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
                                  card.focus(`archive-${routine.id}`);
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
                                aria-disabled={busy || undefined}
                                onClick={() => {
                                  if (!card.isBusy()) void change(() => reorderRoutines(supabase, movedIdsInGroup(own, routine.id, -1)), 'Could not reorder routines. Try again.');
                                }}
                              >
                                <ArrowUp aria-hidden className="size-5" />
                              </Button>
                              <Button
                                variant="quiet"
                                className="size-12 rounded-full p-0"
                                aria-label={`Move ${routineName(routine)} down`}
                                disabled={index === time.routines.length - 1}
                                aria-disabled={busy || undefined}
                                onClick={() => {
                                  if (!card.isBusy()) void change(() => reorderRoutines(supabase, movedIdsInGroup(own, routine.id, 1)), 'Could not reorder routines. Try again.');
                                }}
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
                busy={busy}
                onSave={(input) => change(() => createRoutine(supabase, household.id, profile.id, input, nextSortOrder(own)).then(() => undefined))}
              />
            </div>
          </section>
        );
      })}
    </main>
  );
}
