import { createContext } from 'react';
import { onCalendarScreen, type Occurrence, type WallRoute } from './calendar-occurrences';
import type { Profile } from './profiles';

// The Profile filter on the Wall (CONTEXT.md: Profile): tap a name on the people strip and the calendar shows that
// person's events and the whole Household's. It belongs to the screen it is on: nothing here is
// saved or sent anywhere, so a reload starts with everyone showing. The rule and the pruning are
// pure and the state holder is plain TypeScript with a timer, so a test fakes the clock rather
// than waiting for one.

// How long after the last touch the filter clears itself, and what the status line says when it does. The Wall belongs
// to everyone, so whoever walks past next sees everything, not what the last person was looking at. A tap on a
// person and any touch inside the calendar both count as a touch: someone still reading it has not walked away.
const CLEAR_AFTER_MS = 2 * 60_000;
export const FILTER_CLEARED_WORDS = "Showing everyone's events again";

// A tablet that sleeps runs no timers and wakes with the clock well ahead, so the wait is never longer
// than this and the clock is compared with the deadline each time (the way watchHouseholdDay does).
const MAX_WAIT_MS = 60_000;

// Nothing pressed. One shared array, so the context's default and an empty filter are the same value.
const NONE: readonly string[] = [];

// The occurrences to show for the pressed Profile ids. None pressed shows everything; otherwise an
// occurrence stays when it has no Profiles (it is the whole Household's) or any of its Profiles is pressed.
export function filterOccurrences(occurrences: Occurrence[], pressed: readonly string[]): Occurrence[] {
  if (pressed.length === 0) return occurrences;
  return occurrences.filter((occurrence) => occurrence.profile_ids.length === 0 || occurrence.profile_ids.some((id) => pressed.includes(id)));
}

// The pressed ids that still name a Profile of the Household: a deleted Profile leaves the filter.
export function prunePressed(pressed: readonly string[], profiles: readonly Pick<Profile, 'id'>[]): string[] {
  return pressed.filter((id) => profiles.some((profile) => profile.id === id));
}

export type ProfileFilter = {
  // The pressed Profile ids, in the order they were pressed. The same array until something changes.
  pressed(): readonly string[];
  // Presses a Profile, or lets it go when it is pressed. Each tap starts the two minutes again, by the clock.
  toggle(id: string): void;
  // A touch inside the calendar: starts the two minutes again while anything is pressed, and is nothing otherwise.
  // It is no change, so nobody is told.
  touch(): void;
  // Lets every Profile go.
  clear(): void;
  // Lets go of the Profiles that no longer exist. Not a tap: the two minutes run on.
  prune(profiles: readonly Pick<Profile, 'id'>[]): void;
  // Calls `listener` after each change. Returns the function that stops it.
  subscribe(listener: () => void): () => void;
  // Stops the timer, for when the screen that held the filter is gone.
  dispose(): void;
};

// What the shell gives the filter to say with: the status line, but only while a calendar screen is up (Home, Day, Week or Month), the
// screens that show the events the filter hides. The filter lives as long as the shell and clears wherever the Wall is; on Meals, Routines
// and Lists it clears with nothing said, since "Showing everyone's events again" would be about events that are not on the screen.
// `view` is read when the time is up: the screen the Wall is on then, not the one the Profile was pressed on.
export function sayOnCalendar(say: (words: string) => void, view: () => WallRoute['view']): (words: string) => void {
  return (words) => {
    if (onCalendarScreen(view())) say(words);
  };
}

// `say` is the status line: the filter says its own clearing when the two minutes are up, and nothing when someone
// clears it, lets the last Profile go or a Profile is deleted, who know already.
export function createProfileFilter(say: (words: string) => void = () => undefined): ProfileFilter {
  let pressed: readonly string[] = NONE;
  // The clock time the filter clears itself at, and the timer that looks for it.
  let deadline = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();

  // Moves to `next` and tells the listeners. With nothing pressed there is nothing left to clear, so the timer stops.
  const set = (next: readonly string[]) => {
    pressed = next.length === 0 ? NONE : next;
    if (pressed === NONE) clearTimeout(timer);
    listeners.forEach((listener) => listener());
  };
  const clear = () => {
    if (pressed.length > 0) set(NONE);
  };
  // Looks at the clock at most a minute from now, and clears once it has reached the deadline.
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (Date.now() < deadline) return arm();
      clear();
      say(FILTER_CLEARED_WORDS);
    }, Math.min(Math.max(deadline - Date.now(), 1), MAX_WAIT_MS));
  };
  const restart = () => {
    deadline = Date.now() + CLEAR_AFTER_MS;
    arm();
  };

  return {
    pressed: () => pressed,
    toggle(id) {
      restart();
      set(pressed.includes(id) ? pressed.filter((other) => other !== id) : [...pressed, id]);
    },
    touch() {
      if (pressed.length > 0) restart();
    },
    clear,
    prune(profiles) {
      const kept = prunePressed(pressed, profiles);
      if (kept.length < pressed.length) set(kept);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => clearTimeout(timer),
  };
}

// What the screens under the shell see of the filter: the pressed Profile ids, so a calendar view reads
// the filter without every view passing it down, a way to clear it, for the sheet that has just
// written an event the filter might hide, and `touch`, which the calendar calls for a touch inside it. With no
// provider (a screen under test, the phone) nothing is pressed and there is nothing to clear or keep.
export type ProfileFilterView = { pressed: readonly string[]; clear: () => void; touch: () => void };

export const ProfileFilterContext = createContext<ProfileFilterView>({ pressed: NONE, clear: () => undefined, touch: () => undefined });
