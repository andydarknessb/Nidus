// The hold: Home's cards (Up next and the Pinned List card) keep a row that was just tapped where it is, in the done look, for four
// seconds, so a second tap can take it back and a double tap never lands on the row that follows. This is the plain core of that rule,
// with no screen and no timer; use-hold.ts has the hooks. tests/hold.test.ts drives it.

// How long a tapped row is held, in ms: long enough for a second tap to take the tick back, and for the celebration to play where the
// row was.
export const HOME_HOLD_MS = 4_000;

// What was tapped here and when (epoch milliseconds), by id of the Routine or item.
export type Holds = ReadonlyMap<string, number>;

// Whether `id` is held at `now`. A tap later than `now` counts as held, so a tap does not have to move the clock a card last looked at.
export function isHeld(holds: Holds, id: string, now: number): boolean {
  const at = holds.get(id);
  return at !== undefined && now - at < HOME_HOLD_MS;
}

// When the first of the holds that have not ended ends, or nothing when none is left: when a card has to look again.
export function holdEndsAt(holds: Holds, now: number): number | null {
  const ends = [...holds.values()].map((at) => at + HOME_HOLD_MS).filter((end) => end > now);
  return ends.length === 0 ? null : Math.min(...ends);
}
