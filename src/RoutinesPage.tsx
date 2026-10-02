import { ArrowDown, ArrowUp, Check, Circle, PartyPopper } from 'lucide-react';
import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import type { Household } from './lib/household';
import { PROFILE_PALETTE, loadProfiles, nextSortOrder, type Profile } from './lib/profiles';
import {
  TIME_OF_DAY_GROUPS,
  WEEKDAYS,
  archiveRoutine,
  completeRoutine,
  createRoutine,
  groupByProfile,
  groupByTimeOfDay,
  loadCompletions,
  loadRoutines,
  maskOf,
  movedIdsInGroup,
  reorderRoutines,
  routineProgress,
  showsTimeOfDayHeadings,
  tapFinishesProfile,
  tickOptimistically,
  todaysRoutines,
  uncompleteRoutine,
  updateRoutine,
  isScheduledOn,
  type Routine,
  type RoutineEdit,
  type TimeOfDay,
} from './lib/routines';
import { useRefetchOn } from './lib/change-feed';
import { supabase } from './lib/supabase';
import { createSyncedReader, type SyncedReader } from './lib/synced-reader';
import { useHouseholdDay } from './lib/wall-hooks';

const field = 'min-h-12 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground';
const action = 'min-h-12 rounded-lg px-4 text-base font-medium';
const quiet = `${action} border border-border`;
const iconAction = 'inline-flex size-12 shrink-0 items-center justify-center rounded-lg border border-border disabled:opacity-40';
// The small heading over a group of Routines (Morning, Afternoon, Evening, Any time): the same on the Routines rail and on the phone.
const timeHeading = 'text-base font-medium text-muted-foreground';

// Changes heard from the server normally refresh the rail at once; this slow read is the
// backstop for a change that was missed while the connection was down.
const REFRESH_MS = 30_000;
const ROUTINE_TABLES = ['routines', 'routine_completions', 'profiles'] as const;

// ---- The wall: today's Routines, on the home screen's rail and on the Routines chart ----

type Today = { date: string; routines: Routine[]; profiles: Profile[]; done: Set<string> };

// Today's Routines for the one screen that shows them, the Routines rail on Home or the Routines
// chart: the read and what keeps it current, the tick, and the celebration of a tap that finishes a
// Profile. "Checked" is derived from the completions of today's Household date: nothing resets at
// midnight, yesterday's just stop matching.
function useRoutinesToday(timezone: string) {
  const day = useHouseholdDay(timezone);
  const [loaded, setLoaded] = useState<Today | null>(null);
  const [problem, setProblem] = useState('');
  const [failed, setFailed] = useState(false);
  // The Profiles a tap here has just finished, each with a count that starts its burst again if it
  // finishes twice, until the burst has played. A read, or a tick from another screen, adds none.
  const [celebrating, setCelebrating] = useState<Record<string, number>>({});
  // Reads and the taps made here take turns: a read never lands over a tap in flight, and one
  // follows each tap, so a change from another tablet that arrived meanwhile is shown too.
  const reader = useRef<SyncedReader | null>(null);

  useEffect(() => {
    const date = day.date;
    const next = createSyncedReader(
      async () => {
        const [profiles, routines, completed] = await Promise.all([loadProfiles(supabase), loadRoutines(supabase), loadCompletions(supabase, date)]);
        return { date, profiles, routines, done: new Set(completed) };
      },
      (today) => {
        setLoaded(today);
        setFailed(false);
      },
      () => setFailed(true),
    );
    reader.current = next;
    next.refresh();
    const id = setInterval(() => next.refresh(), REFRESH_MS);
    return () => {
      next.dispose();
      clearInterval(id);
      reader.current = null;
    };
  }, [day.date]);
  useRefetchOn(ROUTINE_TABLES, () => reader.current?.refresh());

  // Loaded for another day (midnight just passed): everything reads unchecked until the new day arrives.
  const done = loaded && loaded.date === day.date ? loaded.done : new Set<string>();
  const groups = loaded ? groupByProfile(loaded.profiles, todaysRoutines(loaded.routines, day.weekday)) : [];

  const endCelebration = (profileId: string) =>
    setCelebrating((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => id !== profileId)));

  async function toggle(routine: Routine) {
    const date = day.date;
    const checking = !done.has(routine.id);
    // Only the tick that finishes its Profile celebrates, and not for someone who asked for less
    // motion: they get "All done" and no burst.
    const own = groups.find((group) => group.profile.id === routine.profile_id)?.routines ?? [];
    const finishing = tapFinishesProfile(own, done, routine.id, checking);
    if (finishing && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setCelebrating((prev) => ({ ...prev, [routine.profile_id]: (prev[routine.profile_id] ?? 0) + 1 }));
    }
    const publish = (update: (ids: Set<string>) => Set<string>) =>
      setLoaded((prev) => (prev && prev.date === date ? { ...prev, done: update(prev.done) } : prev));
    const tap = () =>
      tickOptimistically(publish, routine.id, checking, () =>
        checking ? completeRoutine(supabase, routine.id, date) : uncompleteRoutine(supabase, routine.id, date),
      );
    const stuck = await (reader.current ? reader.current.write(tap) : tap());
    setProblem(stuck ? '' : 'Could not save that tick. It has been put back.');
    // A tick that was put back finished nothing.
    if (finishing && !stuck) endCelebration(routine.profile_id);
  }

  return { loaded: loaded !== null, failed, problem, groups, done, toggle, celebrating, endCelebration };
}

// What a screen of today's Routines says besides the Routines: that they are loading, that they could
// not be read, that a tick was put back, or that none is scheduled.
function RoutinesNotices({ loaded, failed, problem, empty }: { loaded: boolean; failed: boolean; problem: string; empty: boolean }) {
  return (
    <>
      {!loaded && !failed && <p className="text-base">Loading</p>}
      {/* Once Routines have been read, a lost connection keeps them on screen and the header says so. */}
      {failed && !loaded && (
        <p role="alert" className="text-base">
          Could not load Routines. Check your connection.
        </p>
      )}
      {problem && (
        <p role="alert" className="text-base">
          {problem}
        </p>
      )}
      {loaded && empty && <p className="text-base">Nothing scheduled today.</p>}
    </>
  );
}

// The pieces of one burst, one in each colour of the Profile palette: how far each flies sideways,
// how far it rises first and how far it then falls (as a percentage of the group's width or height,
// so a burst fills a short group and a tall one alike), and how far it turns (degrees). Fixed, so a
// burst looks the same each time and a render stays pure. Each starts a little after the one before
// it (index.css), so the last piece is the last to land.
const CONFETTI = [
  [-40, -18, 42, -380],
  [28, -24, 52, 460],
  [-16, -26, 36, 300],
  [44, -14, 46, -520],
  [-48, -12, 54, 410],
  [10, -28, 40, -300],
  [-30, -20, 58, 560],
  [38, -24, 38, -440],
  [-4, -16, 50, 340],
  [48, -10, 56, -480],
] as const;

// A short burst of confetti over one Profile's group. It is drawn over the group but never in the way
// of a tap or of the layout, hidden from assistive technology (the words "All done" say it), and
// gone from the page once its last piece has landed.
function Confetti({ onDone }: { onDone: () => void }) {
  return (
    <span aria-hidden className="confetti pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
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

// One Profile's Routines today: its colour and name, how far along it is (the count and a progress
// bar, or "All done" with an icon once every one is ticked), then the Routines as buttons to tick,
// under their time of day headings when the Profile uses them. The Routines rail shows it compact; on
// the chart it is a column of its own, which scrolls on its own when its Routines do not fit.
function ProfileGroup({
  profile,
  routines,
  done,
  onToggle,
  burst,
  onBurstEnd,
  chart = false,
}: {
  profile: Profile;
  routines: Routine[];
  done: Set<string>;
  onToggle: (routine: Routine) => Promise<void>;
  // Set while a burst plays over this group; a new value plays it again.
  burst: number | undefined;
  onBurstEnd: () => void;
  chart?: boolean;
}) {
  // A group always has a Routine today: groupByProfile leaves out the Profiles with none.
  const { done: count, total } = routineProgress(routines, done);
  const finished = count === total;
  const times = groupByTimeOfDay(routines);
  const headed = showsTimeOfDayHeadings(routines);
  return (
    <section
      aria-labelledby={`routines-${profile.id}`}
      className={chart ? 'relative flex min-h-0 max-w-md min-w-64 flex-1 flex-col gap-3 rounded-xl border border-border p-4' : 'relative flex flex-col gap-2'}
    >
      <div className="flex flex-col gap-2">
        {/* A name too long to share the line with the count drops it to a line of its own, rather than squeezing the name.
            The count's room is as wide as "All done", so the heading wraps the same either way and nothing below it moves when one becomes the other. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3
            id={`routines-${profile.id}`}
            className={`flex min-w-0 items-center gap-2 font-semibold ${chart ? 'text-2xl' : 'text-xl'}`}
            style={{ color: profile.color }}
          >
            <span aria-hidden className="size-4 shrink-0 rounded-full" style={{ backgroundColor: profile.color }} />
            <span className="min-w-0 break-words">{profile.name}</span>
          </h3>
          <span className={`ml-auto flex shrink-0 items-center justify-end gap-1.5 font-medium ${chart ? 'min-w-28 text-xl' : 'min-w-24 text-base'}`}>
            {!finished && `${count} of ${total}`}
            {/* Always on the page, so a screen reader hears "All done" when it appears and not when Routines load already done. */}
            <span role="status" className="flex items-center gap-1.5">
              {finished && (
                <>
                  <PartyPopper aria-hidden className="size-5 shrink-0" />
                  All done
                </>
              )}
            </span>
          </span>
        </div>
        <div
          role="progressbar"
          aria-label={`${profile.name}: ${count} of ${total} ${total === 1 ? 'Routine' : 'Routines'} done`}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={count}
          className={`overflow-hidden rounded-full bg-muted ring-1 ring-muted-foreground/60 ${chart ? 'h-3' : 'h-2'}`}
        >
          <div className="h-full rounded-full" style={{ width: `${(count / total) * 100}%`, backgroundColor: profile.color }} />
        </div>
      </div>
      <div className={chart ? '-m-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-1' : 'flex flex-col gap-2'}>
        {times.map((time) => (
          <Fragment key={time.label}>
            {headed && <h4 className={timeHeading}>{time.label}</h4>}
            <ul className="flex flex-col gap-2">
              {time.routines.map((routine) => {
                const checked = done.has(routine.id);
                return (
                  <li key={routine.id}>
                    <button
                      type="button"
                      aria-pressed={checked}
                      onClick={() => void onToggle(routine)}
                      className="flex min-h-14 w-full items-center gap-3 rounded-lg border-2 px-3 text-left text-lg"
                      style={
                        checked
                          ? { backgroundColor: profile.color, borderColor: profile.color, color: '#09090b' }
                          : { borderColor: profile.color }
                      }
                    >
                      {checked ? <Check aria-hidden className="size-6 shrink-0" /> : <Circle aria-hidden className="size-6 shrink-0" />}
                      <span className={checked ? 'line-through decoration-2' : ''}>{routine.title}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Fragment>
        ))}
      </div>
      {burst !== undefined && <Confetti key={burst} onDone={onBurstEnd} />}
    </section>
  );
}

// Today's Routines under each Profile's name and colour: the home screen's right rail.
export function RoutinesRail({ timezone }: { timezone: string }) {
  const { loaded, failed, problem, groups, done, toggle, celebrating, endCelebration } = useRoutinesToday(timezone);

  return (
    <aside aria-label="Today's Routines" className="flex min-h-0 flex-col gap-4 overflow-y-auto rounded-xl border border-border p-4">
      <h2 className="text-2xl font-semibold">Routines</h2>
      <RoutinesNotices loaded={loaded} failed={failed} problem={problem} empty={groups.length === 0} />
      {groups.map(({ profile, routines }) => (
        <ProfileGroup
          key={profile.id}
          profile={profile}
          routines={routines}
          done={done}
          onToggle={toggle}
          burst={celebrating[profile.id]}
          onBurstEnd={() => endCelebration(profile.id)}
        />
      ))}
    </aside>
  );
}

// The Routines chart, a screen of its own: a column for each Profile that has Routines today, side by
// side in the Profiles' order and filling the height, reading and ticking exactly as the Routines rail
// does. Only when there are more Profiles than fit at a readable width does the row scroll sideways.
export function RoutinesChart({ timezone }: { timezone: string }) {
  const { loaded, failed, problem, groups, done, toggle, celebrating, endCelebration } = useRoutinesToday(timezone);
  // Focus goes to the page's title on arrival, as on the calendar pages, rather than staying on the navigation rail.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  return (
    <section aria-labelledby="routines-chart-title" className="flex min-h-0 flex-col gap-4">
      <h2 id="routines-chart-title" ref={heading} tabIndex={-1} className="text-2xl font-semibold outline-none">
        Routines
      </h2>
      <RoutinesNotices loaded={loaded} failed={failed} problem={problem} empty={groups.length === 0} />
      <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto">
        {groups.map(({ profile, routines }) => (
          <ProfileGroup
            key={profile.id}
            chart
            profile={profile}
            routines={routines}
            done={done}
            onToggle={toggle}
            burst={celebrating[profile.id]}
            onBurstEnd={() => endCelebration(profile.id)}
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

// One form for adding a Routine and for editing one: a title, the days and a time of day.
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
  // Saving is true while a save is in flight, so a second tap cannot send it twice. Failed says the
  // last one did not go through: the form stays open with what was typed, and says so beside Save.
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  // What the labels name, so no two forms on the page share a label.
  const about = routine ? routine.title : `${profile.name}'s new Routine`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || mask === 0 || saving) return;
    setSaving(true);
    setFailed(false);
    const saved = await onSave({ title, days_of_week: mask, time_of_day: timeOfDay });
    setSaving(false);
    setFailed(!saved);
    if (saved && !routine) {
      setTitle('');
      setMask(allDays);
      setTimeOfDay(null);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
      <label className="flex flex-col gap-2 text-base">
        {routine ? `Title for ${routine.title}` : `New Routine for ${profile.name}`}
        <input
          className={field}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={100}
          placeholder="Feed the dog"
          required
          autoFocus={routine !== undefined}
        />
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-base">Days for {about}</legend>
        <div className="flex flex-wrap gap-2">
          {weekOrder.map((weekday) => (
            <label
              key={weekday.bit}
              className="flex min-h-12 min-w-12 cursor-pointer items-center justify-center rounded-lg border-2 border-border px-2 text-base font-medium has-[:checked]:border-foreground has-[:checked]:bg-muted has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-foreground"
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={isScheduledOn(mask, weekday.bit)}
                onChange={(e) => setMask(e.target.checked ? mask | (1 << weekday.bit) : mask & ~(1 << weekday.bit))}
                aria-label={weekday.name}
              />
              {weekday.short}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-2 text-base">
        Time of day for {about}
        <select
          className={field}
          value={timeOfDay ?? ''}
          onChange={(e) => setTimeOfDay(TIME_OF_DAY_GROUPS.find((group) => group.value === e.target.value)?.value ?? null)}
        >
          {timeOfDayChoices.map((choice) => (
            <option key={choice.label} value={choice.value ?? ''}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
      <div className="flex gap-3">
        <button type="submit" className={`${action} flex-1 bg-primary text-primary-foreground disabled:opacity-40`} disabled={mask === 0 || saving}>
          {routine ? 'Save' : 'Add Routine'}
        </button>
        {onCancel && (
          <button type="button" className={quiet} onClick={onCancel}>
            Cancel
          </button>
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
    <main className="mx-auto flex min-h-svh max-w-md flex-col gap-6 p-4">
      <h1 className="text-2xl font-semibold">Routines</h1>
      <p role="status" className="min-h-6 text-base">
        {problem}
      </p>
      {profiles?.length === 0 && (
        <p className="text-base">
          Add a Profile first, in <a href="/settings" className="underline">Household settings</a>. Routines belong to a Profile.
        </p>
      )}

      {profiles?.map((profile) => {
        const own = ofProfile(profile.id);
        // The groups, their order and the heading rule are the Routines rail's, so the phone never lists an order the Wall does not show.
        const times = groupByTimeOfDay(own);
        const headed = showsTimeOfDayHeadings(own);
        return (
          <section key={profile.id} aria-labelledby={`profile-${profile.id}`} className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <h2 id={`profile-${profile.id}`} tabIndex={-1} className="flex items-center gap-2 text-xl font-semibold" style={{ color: profile.color }}>
              <span aria-hidden className="size-4 shrink-0 rounded-full" style={{ backgroundColor: profile.color }} />
              {profile.name}
            </h2>
            {own.length === 0 && <p className="text-base">No Routines yet.</p>}
            {times.map((time) => (
              <Fragment key={time.label}>
                {headed && <h3 className={timeHeading}>{time.label}</h3>}
                <ul className="flex flex-col gap-3">
                  {time.routines.map((routine, index) => (
                    <li key={routine.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
                      {editing === routine.id ? (
                        <RoutineForm profile={profile} routine={routine} onSave={(input) => save(routine.id, input)} onCancel={() => stopEditing(routine.id)} />
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <div className="flex-1">
                              <p className="text-base font-medium">{routine.title}</p>
                              <p className="text-base">{scheduleSummary(routine.days_of_week, routine.time_of_day)}</p>
                            </div>
                            <button
                              type="button"
                              className={iconAction}
                              aria-label={`Move ${routineName(routine)} up`}
                              disabled={index === 0}
                              onClick={() =>
                                void change(() => reorderRoutines(supabase, movedIdsInGroup(own, routine.id, -1)), 'Could not reorder Routines. Try again.')
                              }
                            >
                              <ArrowUp aria-hidden className="size-5" />
                            </button>
                            <button
                              type="button"
                              className={iconAction}
                              aria-label={`Move ${routineName(routine)} down`}
                              disabled={index === time.routines.length - 1}
                              onClick={() =>
                                void change(() => reorderRoutines(supabase, movedIdsInGroup(own, routine.id, 1)), 'Could not reorder Routines. Try again.')
                              }
                            >
                              <ArrowDown aria-hidden className="size-5" />
                            </button>
                          </div>
                          {confirming === routine.id ? (
                            <div className="flex gap-3">
                              <button
                                type="button"
                                autoFocus
                                aria-label={`Archive ${routineName(routine)}`}
                                className={`${action} flex-1 border-2 border-destructive bg-primary text-primary-foreground`}
                                onClick={() => {
                                  setConfirming(null);
                                  setFocusNext(`profile-${profile.id}`);
                                  void change(() => archiveRoutine(supabase, routine.id), 'Could not archive that Routine. Try again.');
                                }}
                              >
                                Archive {routine.title}
                              </button>
                              <button
                                type="button"
                                className={quiet}
                                onClick={() => {
                                  setConfirming(null);
                                  setFocusNext(`archive-${routine.id}`);
                                }}
                              >
                                Keep it
                              </button>
                            </div>
                          ) : (
                            <div className="flex gap-3">
                              <button
                                type="button"
                                id={`edit-${routine.id}`}
                                className={`${quiet} flex-1`}
                                aria-label={`Edit ${routineName(routine)}`}
                                onClick={() => startEditing(routine.id)}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                id={`archive-${routine.id}`}
                                className={`${quiet} flex-1`}
                                aria-label={`Archive ${routineName(routine)}`}
                                onClick={() => setConfirming(routine.id)}
                              >
                                Archive
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </Fragment>
            ))}
            <RoutineForm
              profile={profile}
              onSave={(input) => change(() => createRoutine(supabase, household.id, profile.id, input, nextSortOrder(own)).then(() => undefined))}
            />
          </section>
        );
      })}
    </main>
  );
}
