import { createContext } from 'react';
import type { Occurrence } from './calendar-occurrences';
import type { Profile } from './profiles';

// The Profile filter on the Wall (CONTEXT.md: Profile): tap a name and the calendar shows that
// person's events and the whole Household's. It belongs to the screen it is on: nothing here is
// saved or sent anywhere, so a reload starts with everyone showing. The rule and the pruning are
// pure and the state holder is plain TypeScript with a timer, so a test fakes the clock rather
// than waiting for one.

// How long after the last tap the filter clears itself. The Wall belongs to everyone, so whoever
// walks past next sees everything, not what the last person was looking at.
const CLEAR_AFTER_MS = 2 * 60_000;

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
  // Presses a Profile, or lets it go when it is pressed. Each tap starts the two minutes again.
  toggle(id: string): void;
  // Lets every Profile go.
  clear(): void;
  // Lets go of the Profiles that no longer exist. Not a tap: the two minutes run on.
  prune(profiles: readonly Pick<Profile, 'id'>[]): void;
  // Calls `listener` after each change. Returns the function that stops it.
  subscribe(listener: () => void): () => void;
  // Stops the timer, for when the screen that held the filter is gone.
  dispose(): void;
};

export function createProfileFilter(): ProfileFilter {
  let pressed: readonly string[] = NONE;
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

  return {
    pressed: () => pressed,
    toggle(id) {
      clearTimeout(timer);
      timer = setTimeout(clear, CLEAR_AFTER_MS);
      set(pressed.includes(id) ? pressed.filter((other) => other !== id) : [...pressed, id]);
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

// The pressed Profile ids for the screens under the shell, so a calendar view reads the filter
// without every view passing it down. With no provider (a screen under test) nothing is pressed.
export const PressedProfilesContext = createContext<readonly string[]>(NONE);
