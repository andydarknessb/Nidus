// What the Wall keeps of its Household on the Device, so a Wall that starts with no server can still
// show the Household's name and a clock in its Household Timezone. Only those two: the gate draws
// nothing else from memory.

export type RememberedHousehold = { name: string; timezone: string };

const KEY = 'nidus.household';

// A Wall that cannot reach its server says so from the third failed try in a row.
const FAILED_TRIES_BEFORE_OFFLINE = 3;

// The Device's localStorage, or null where even touching it throws (storage blocked).
export function deviceStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function rememberHousehold(storage: Storage | null, household: RememberedHousehold): void {
  try {
    storage!.setItem(KEY, JSON.stringify({ name: household.name, timezone: household.timezone }));
  } catch {
    // Storage full or blocked: the Wall works without a memory.
  }
}

// Null when nothing usable is remembered: never stored, unreadable, the wrong shape, a timezone the clock
// cannot format, or a storage that throws.
export function recallHousehold(storage: Storage | null): RememberedHousehold | null {
  try {
    const stored: unknown = JSON.parse(storage!.getItem(KEY) ?? 'null');
    if (typeof stored !== 'object' || stored === null) return null;
    const { name, timezone } = stored as Record<string, unknown>;
    if (typeof name !== 'string' || typeof timezone !== 'string') return null;
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return { name, timezone };
  } catch {
    return null;
  }
}

export function gateWords(failedTries: number): string {
  return failedTries >= FAILED_TRIES_BEFORE_OFFLINE ? 'No internet. Trying again.' : 'Connecting';
}
