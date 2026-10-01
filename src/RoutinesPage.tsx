import { ArrowDown, ArrowUp, Check, Circle } from 'lucide-react';
import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Household } from './lib/household';
import { loadProfiles, nextSortOrder, type Profile } from './lib/profiles';
import {
  TIME_OF_DAY_GROUPS,
  WEEKDAYS,
  archiveRoutine,
  completeRoutine,
  createRoutine,
  groupByProfile,
  groupByTimeOfDay,
  householdDay,
  loadCompletions,
  loadRoutines,
  maskOf,
  movedIdsInGroup,
  reorderRoutines,
  tickOptimistically,
  todaysRoutines,
  uncompleteRoutine,
  updateRoutine,
  isScheduledOn,
  type Routine,
  type RoutineInput,
  type TimeOfDay,
} from './lib/routines';
import { useRefetchOn } from './lib/change-feed';
import { watchHouseholdDay } from './lib/household-day';
import { supabase } from './lib/supabase';
import { createSyncedReader, type SyncedReader } from './lib/synced-reader';

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

// ---- The wall: today's Routines on the home screen's rail ---------------------------

type Today = { date: string; routines: Routine[]; profiles: Profile[]; done: Set<string> };

// The current Household date, moved on by a timer keyed to Household midnight.
function useHouseholdDay(timezone: string) {
  const [day, setDay] = useState(() => householdDay(timezone));
  useEffect(() => {
    setDay(householdDay(timezone));
    return watchHouseholdDay(timezone, setDay);
  }, [timezone]);
  return day;
}

// Today's Routines under each Profile's name and colour. "Checked" is derived from the
// completions of today's Household date: nothing resets at midnight, yesterday's just stop matching.
export function RoutinesRail({ timezone }: { timezone: string }) {
  const day = useHouseholdDay(timezone);
  const [loaded, setLoaded] = useState<Today | null>(null);
  const [problem, setProblem] = useState('');
  const [failed, setFailed] = useState(false);
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

  async function toggle(routine: Routine) {
    const date = day.date;
    const checking = !done.has(routine.id);
    const publish = (update: (ids: Set<string>) => Set<string>) =>
      setLoaded((prev) => (prev && prev.date === date ? { ...prev, done: update(prev.done) } : prev));
    const tap = () =>
      tickOptimistically(publish, routine.id, checking, () =>
        checking ? completeRoutine(supabase, routine.id, date) : uncompleteRoutine(supabase, routine.id, date),
      );
    const stuck = await (reader.current ? reader.current.write(tap) : tap());
    setProblem(stuck ? '' : 'Could not save that tick. It has been put back.');
  }

  return (
    <aside aria-label="Today's Routines" className="flex min-h-0 flex-col gap-4 overflow-y-auto rounded-xl border border-border p-4">
      <h2 className="text-2xl font-semibold">Routines</h2>
      {loaded === null && !failed && <p className="text-base">Loading</p>}
      {/* Once Routines have been read, a lost connection keeps them on screen and the header says so. */}
      {failed && loaded === null && (
        <p role="alert" className="text-base">
          Could not load Routines. Check your connection.
        </p>
      )}
      {problem && (
        <p role="alert" className="text-base">
          {problem}
        </p>
      )}
      {loaded && groups.length === 0 && <p className="text-base">Nothing scheduled today.</p>}
      {groups.map(({ profile, routines }) => {
        const times = groupByTimeOfDay(routines);
        // A Profile whose Routines are all Any time reads as the Routines rail always has: no headings.
        const headed = times.some((time) => time.value !== null);
        return (
          <section key={profile.id} aria-labelledby={`routines-${profile.id}`} className="flex flex-col gap-2">
            <h3 id={`routines-${profile.id}`} className="flex items-center gap-2 text-xl font-semibold" style={{ color: profile.color }}>
              <span aria-hidden className="size-4 shrink-0 rounded-full" style={{ backgroundColor: profile.color }} />
              {profile.name}
            </h3>
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
                          onClick={() => void toggle(routine)}
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
          </section>
        );
      })}
    </aside>
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
  const time = TIME_OF_DAY_GROUPS.find((group) => group.value !== null && group.value === timeOfDay);
  return time ? `${days}\u00a0·\u00a0${time.label}` : days;
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
  onSave: (input: RoutineInput) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [title, setTitle] = useState(routine?.title ?? '');
  const [mask, setMask] = useState(routine?.days_of_week ?? allDays);
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay | null>(routine?.time_of_day ?? null);
  // What the labels name, so no two forms on the page share a label.
  const about = routine ? routine.title : `${profile.name}'s new Routine`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || mask === 0) return;
    if ((await onSave({ title, days_of_week: mask, time_of_day: timeOfDay })) && !routine) {
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
        <button type="submit" className={`${action} flex-1 bg-primary text-primary-foreground disabled:opacity-40`} disabled={mask === 0}>
          {routine ? 'Save' : 'Add Routine'}
        </button>
        {onCancel && (
          <button type="button" className={quiet} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
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

  // Runs one change, then reloads so the screen shows what the database holds.
  async function change(work: () => Promise<void>, failure: string): Promise<boolean> {
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

  // Save and Cancel both end on the row's Edit button, which the swap back has just put on screen.
  function stopEditing(id: string) {
    setEditing(null);
    setFocusNext(`edit-${id}`);
  }

  // A failed save keeps the form open, with what was typed, and says so in the status line.
  async function save(id: string, input: RoutineInput): Promise<boolean> {
    const ok = await change(() => updateRoutine(supabase, id, input), 'Could not save that Routine. Check the name and days, then try again.');
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
        const headed = times.some((time) => time.value !== null);
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
                              aria-label={`Move ${routine.title} up`}
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
                              aria-label={`Move ${routine.title} down`}
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
                              <button type="button" id={`edit-${routine.id}`} className={`${quiet} flex-1`} aria-label={`Edit ${routine.title}`} onClick={() => setEditing(routine.id)}>
                                Edit
                              </button>
                              <button
                                type="button"
                                id={`archive-${routine.id}`}
                                className={`${quiet} flex-1`}
                                aria-label={`Archive ${routine.title}`}
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
              onSave={(input) =>
                change(
                  () => createRoutine(supabase, household.id, profile.id, input, nextSortOrder(own)).then(() => undefined),
                  'Could not add that Routine. Check the name and days, then try again.',
                )
              }
            />
          </section>
        );
      })}
    </main>
  );
}
