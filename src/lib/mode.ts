import { addDays } from './calendar-occurrences';
import { TOKENS, type Mode } from './look';
import { wallMs } from './native-events';
import { householdDay } from './routines';

// The mode of a screen: light or dark, by the Household's Appearance (CONTEXT.md), the screen's own switch, the
// clock and the sun. The document's `data-mode` is the only switch: components never branch on it for colour
// (docs/look.md), and applyMode() is the one place that sets it. Everything here that decides takes the Household
// Timezone and reads no clock; src/lib/use-mode.ts keeps a screen's mode right as time passes.

export type Appearance = 'auto' | 'light' | 'dark';

// What a screen's own switch sets: a mode, until an instant (epoch milliseconds). It lives on that screen alone, in
// localStorage, and is never written to the database, so a Device needs no new grant.
export type ModeOverride = { mode: Mode; until: number };

// The fallback hours when the weather is off or has no forecast for today: light from 7:00 to 19:00 Household time.
const SUNRISE = '07:00';
const SUNSET = '19:00';

// The Household date `now` falls on, and that date's sunrise and sunset as instants: the ones given, else the
// fallback hours on that date in the Household Timezone (wallMs finds the instant a wall-clock time is, daylight
// saving included).
function sunToday(now: number, timezone: string, sunrise: number | undefined, sunset: number | undefined) {
  const date = householdDay(timezone, new Date(now)).date;
  return { date, sunrise: sunrise ?? wallMs(date, SUNRISE, timezone), sunset: sunset ?? wallMs(date, SUNSET, timezone) };
}

export type ModeInputs = {
  // The Household's Appearance. It is always Auto until the Appearance setting exists.
  appearance?: Appearance | undefined;
  // What this screen's switch set, if it has been used: it wins until the instant it ends.
  override?: ModeOverride | null | undefined;
  now: number;
  // The Household Timezone; null until the Household has been read.
  timezone: string | null;
  // Today's sunrise and sunset, as instants; 7:00 and 19:00 in the Household Timezone when left out.
  sunrise?: number | undefined;
  sunset?: number | undefined;
  // The mode this screen last resolved (light when it has none): what it keeps until the Household is read.
  last?: Mode | undefined;
};

// An override that has not ended wins; otherwise Light or Dark as the Household set; otherwise Auto, which is
// light from sunrise to sunset. Until the Household is read there is nothing to resolve with, so the screen
// keeps the mode it last had and does not flip when the Household arrives.
export function resolveMode({ appearance = 'auto', override, now, timezone, sunrise, sunset, last = 'light' }: ModeInputs): Mode {
  if (timezone === null) return last;
  if (override && now < override.until) return override.mode;
  if (appearance !== 'auto') return appearance;
  const sun = sunToday(now, timezone, sunrise, sunset);
  return now >= sun.sunrise && now < sun.sunset ? 'light' : 'dark';
}

// The next sunrise or sunset after `now`: when the switch's override ends. After today's sunset it is the next
// morning's sunrise, `nextSunrise` if it is known and 7:00 on the Household's next date if not.
export function nextBoundary({
  now,
  timezone,
  sunrise,
  sunset,
  nextSunrise,
}: {
  now: number;
  timezone: string;
  sunrise?: number | undefined;
  sunset?: number | undefined;
  nextSunrise?: number | undefined;
}): number {
  const sun = sunToday(now, timezone, sunrise, sunset);
  if (now < sun.sunrise) return sun.sunrise;
  if (now < sun.sunset) return sun.sunset;
  return nextSunrise ?? wallMs(addDays(sun.date, 1), SUNRISE, timezone);
}

// ---- What a screen keeps in localStorage ------------------------------------------------------
// The key the inline script in index.html reads is MODE_KEY; tests/mode.test.ts runs that script against it.

export const MODE_KEY = 'nidus:mode';
export const OVERRIDE_KEY = 'nidus:mode-override';

export type ModeStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

// localStorage, or null where the browser will not give it (blocked site data): even reading the property can
// throw. Everything below treats no storage as a screen that remembers nothing, never as an error.
export function localStore(): ModeStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// The mode this screen last resolved, which index.html paints before anything else: light when there is none.
export function readLastMode(store: ModeStore | null): Mode {
  try {
    return store?.getItem(MODE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function writeLastMode(store: ModeStore | null, mode: Mode): void {
  try {
    store?.setItem(MODE_KEY, mode);
  } catch {
    // Nowhere to keep it: the next load is light.
  }
}

// The switch's override, if it has not ended by `now`.
export function readOverride(store: ModeStore | null, now: number): ModeOverride | null {
  try {
    const stored = JSON.parse(store?.getItem(OVERRIDE_KEY) ?? 'null') as Partial<ModeOverride> | null;
    const valid = stored && (stored.mode === 'light' || stored.mode === 'dark') && typeof stored.until === 'number' && stored.until > now;
    return valid ? { mode: stored.mode as Mode, until: stored.until as number } : null;
  } catch {
    return null;
  }
}

export function writeOverride(store: ModeStore | null, override: ModeOverride | null): void {
  try {
    if (override) store?.setItem(OVERRIDE_KEY, JSON.stringify(override));
    else store?.removeItem(OVERRIDE_KEY);
  } catch {
    // Nowhere to keep it: the override lasts until the page is reloaded.
  }
}

// Sets the document's mode, and keeps the browser's own idea of it in step: `color-scheme` (form controls,
// scrollbars) and the `theme-color` of the page.
export function applyMode(mode: Mode, doc: Document = document): void {
  doc.documentElement.dataset.mode = mode;
  doc.querySelector('meta[name="color-scheme"]')?.setAttribute('content', mode);
  doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', TOKENS[mode].background);
}
