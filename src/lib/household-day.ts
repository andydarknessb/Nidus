import { addDays, dayStartMs } from './calendar-occurrences';
import { householdDay, type HouseholdDay } from './routines';

// "Today" on the wall is the current date in the Household Timezone, never the machine's, and it
// changes at Household midnight with no refresh. Everything here reads the clock afresh (and takes
// the zone where it needs one), so a test fakes the clock rather than waiting for one.

// Milliseconds from `now` to the next Household midnight: 23 or 25 hours on a daylight saving
// change, and midnight itself where a zone skips it (the next day's first instant).
export function msUntilHouseholdMidnight(timezone: string, now: Date = new Date()): number {
  const tomorrow = addDays(householdDay(timezone, now).date, 1);
  return dayStartMs(tomorrow, timezone) - now.getTime();
}

// A sleeping tablet or a corrected clock can pass midnight without a timer firing, so the wait is
// never longer than this and the date is compared again each time.
const MAX_WAIT_MS = 60_000;

// Calls `onChange` with the new day whenever the Household date moves on. Returns the stop function.
export function watchHouseholdDay(timezone: string, onChange: (day: HouseholdDay) => void): () => void {
  let last = householdDay(timezone).date;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const arm = () => {
    timer = setTimeout(check, Math.min(Math.max(msUntilHouseholdMidnight(timezone), 1), MAX_WAIT_MS));
  };
  const check = () => {
    const day = householdDay(timezone);
    if (day.date !== last) {
      last = day.date;
      onChange(day);
    }
    arm();
  };

  arm();
  return () => clearTimeout(timer);
}

const MINUTE_MS = 60_000;

// Calls `onChange` at the start of each minute, so a clock that shows minutes is never late. Time
// zones now offset by whole minutes, so a minute starts at the same instant on every wall clock. Each
// wait is worked out from the clock afresh, so after a timer that ran early or a clock that was
// corrected, the next call lands on the minute again. Returns the stop function.
export function watchMinute(onChange: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const arm = () => {
    timer = setTimeout(() => {
      onChange();
      arm();
    }, MINUTE_MS - (Date.now() % MINUTE_MS));
  };

  arm();
  return () => clearTimeout(timer);
}
