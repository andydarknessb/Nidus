import { ArrowDown, ArrowUp, Check, Circle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Household } from './lib/household';
import { loadProfiles, movedIds, nextSortOrder, type Profile } from './lib/profiles';
import {
  WEEKDAYS,
  archiveRoutine,
  completeRoutine,
  createRoutine,
  groupByProfile,
  householdDay,
  loadCompletions,
  loadRoutines,
  maskOf,
  reorderRoutines,
  tickOptimistically,
  todaysRoutines,
  uncompleteRoutine,
  isScheduledOn,
  type Routine,
} from './lib/routines';
import { supabase } from './lib/supabase';

const field = 'min-h-12 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground';
const action = 'min-h-12 rounded-lg px-4 text-base font-medium';
const quiet = `${action} border border-border`;
const iconAction = 'inline-flex size-12 shrink-0 items-center justify-center rounded-lg border border-border disabled:opacity-40';

// How often the wall checks whether Household midnight has passed, and re-reads
// Routines and completions so edits from the phone and ticks from another tablet show up.
const DAY_CHECK_MS = 15_000;
const REFRESH_MS = 30_000;

// ---- The wall: today's Routines on the home screen's rail ---------------------------

type Today = { date: string; routines: Routine[]; profiles: Profile[]; done: Set<string> };

// The current Household date, re-read on a timer so the wall rolls over at Household midnight.
function useHouseholdDay(timezone: string) {
  const [day, setDay] = useState(() => householdDay(timezone));
  useEffect(() => {
    setDay(householdDay(timezone));
    const id = setInterval(() => {
      const next = householdDay(timezone);
      setDay((prev) => (prev.date === next.date ? prev : next));
    }, DAY_CHECK_MS);
    return () => clearInterval(id);
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
  // Ticks in flight: a refresh landing meanwhile would show the stale answer over the tap.
  const writing = useRef(0);

  useEffect(() => {
    let live = true;
    const date = day.date;
    async function read() {
      if (writing.current > 0) return;
      try {
        const [profiles, routines, completed] = await Promise.all([loadProfiles(supabase), loadRoutines(supabase), loadCompletions(supabase, date)]);
        if (live && writing.current === 0) {
          setLoaded({ date, profiles, routines, done: new Set(completed) });
          setFailed(false);
        }
      } catch {
        if (live) setFailed(true);
      }
    }
    void read();
    const id = setInterval(() => void read(), REFRESH_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [day.date]);

  // Loaded for another day (midnight just passed): everything reads unchecked until the new day arrives.
  const done = loaded && loaded.date === day.date ? loaded.done : new Set<string>();
  const groups = loaded ? groupByProfile(loaded.profiles, todaysRoutines(loaded.routines, day.weekday)) : [];

  async function toggle(routine: Routine) {
    const date = day.date;
    const checking = !done.has(routine.id);
    const publish = (update: (ids: Set<string>) => Set<string>) =>
      setLoaded((prev) => (prev && prev.date === date ? { ...prev, done: update(prev.done) } : prev));
    writing.current += 1;
    try {
      const stuck = await tickOptimistically(publish, routine.id, checking, () =>
        checking ? completeRoutine(supabase, routine.id, date) : uncompleteRoutine(supabase, routine.id, date),
      );
      setProblem(stuck ? '' : 'Could not save that tick. It has been put back.');
    } finally {
      writing.current -= 1;
    }
  }

  return (
    <aside aria-label="Today's Routines" className="flex min-h-0 flex-col gap-4 overflow-y-auto rounded-xl border border-border p-4">
      <h2 className="text-2xl font-semibold">Routines</h2>
      {loaded === null && !failed && <p className="text-base">Loading</p>}
      {failed && (
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
      {groups.map(({ profile, routines }) => (
        <section key={profile.id} aria-labelledby={`routines-${profile.id}`} className="flex flex-col gap-2">
          <h3 id={`routines-${profile.id}`} className="flex items-center gap-2 text-xl font-semibold" style={{ color: profile.color }}>
            <span aria-hidden className="size-4 shrink-0 rounded-full" style={{ backgroundColor: profile.color }} />
            {profile.name}
          </h3>
          <ul className="flex flex-col gap-2">
            {routines.map((routine) => {
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
        </section>
      ))}
    </aside>
  );
}

// ---- The phone: manage Routines per Profile (Household Account only) ------------------

const allDays = maskOf(WEEKDAYS.map((weekday) => weekday.bit));

function scheduleSummary(mask: number): string {
  if (mask === allDays) return 'Every day';
  return WEEKDAYS.filter((weekday) => isScheduledOn(mask, weekday.bit))
    .map((weekday) => weekday.short)
    .join(', ');
}

// Monday first on screen; the bits stay Sunday = 0.
const weekOrder = [...WEEKDAYS.slice(1), WEEKDAYS[0]];

function NewRoutineForm({ profile, onCreate }: { profile: Profile; onCreate: (title: string, mask: number) => Promise<boolean> }) {
  const [title, setTitle] = useState('');
  const [mask, setMask] = useState(allDays);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || mask === 0) return;
    if (await onCreate(title, mask)) {
      setTitle('');
      setMask(allDays);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
      <label className="flex flex-col gap-2 text-base">
        New Routine for {profile.name}
        <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} placeholder="Feed the dog" required />
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-base">Days for {profile.name}&apos;s new Routine</legend>
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
      <button type="submit" className={`${action} bg-primary text-primary-foreground disabled:opacity-40`} disabled={mask === 0}>
        Add Routine
      </button>
      {mask === 0 && <p className="text-base">Pick at least one day.</p>}
    </form>
  );
}

export function RoutinesPage({ household }: { household: Household }) {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [problem, setProblem] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);

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
        return (
          <section key={profile.id} aria-labelledby={`profile-${profile.id}`} className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <h2 id={`profile-${profile.id}`} className="flex items-center gap-2 text-xl font-semibold" style={{ color: profile.color }}>
              <span aria-hidden className="size-4 shrink-0 rounded-full" style={{ backgroundColor: profile.color }} />
              {profile.name}
            </h2>
            {own.length === 0 && <p className="text-base">No Routines yet.</p>}
            <ul className="flex flex-col gap-3">
              {own.map((routine, index) => (
                <li key={routine.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <p className="text-base font-medium">{routine.title}</p>
                      <p className="text-base">{scheduleSummary(routine.days_of_week)}</p>
                    </div>
                    <button
                      type="button"
                      className={iconAction}
                      aria-label={`Move ${routine.title} up`}
                      disabled={index === 0}
                      onClick={() =>
                        void change(() => reorderRoutines(supabase, movedIds(own.map((r) => r.id), routine.id, -1)), 'Could not reorder Routines. Try again.')
                      }
                    >
                      <ArrowUp aria-hidden className="size-5" />
                    </button>
                    <button
                      type="button"
                      className={iconAction}
                      aria-label={`Move ${routine.title} down`}
                      disabled={index === own.length - 1}
                      onClick={() =>
                        void change(() => reorderRoutines(supabase, movedIds(own.map((r) => r.id), routine.id, 1)), 'Could not reorder Routines. Try again.')
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
                          void change(() => archiveRoutine(supabase, routine.id), 'Could not archive that Routine. Try again.');
                        }}
                      >
                        Archive {routine.title}
                      </button>
                      <button type="button" className={quiet} onClick={() => setConfirming(null)}>
                        Keep it
                      </button>
                    </div>
                  ) : (
                    <button type="button" className={quiet} aria-label={`Archive ${routine.title}`} onClick={() => setConfirming(routine.id)}>
                      Archive
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <NewRoutineForm
              profile={profile}
              onCreate={(title, mask) =>
                change(
                  () => createRoutine(supabase, household.id, profile.id, { title, days_of_week: mask }, nextSortOrder(own)).then(() => undefined),
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
