import { addDays } from './calendar-occurrences';
import { TOKENS, type Mode } from './look';
import { wallMs } from './native-events';
import { householdDay } from './routines';
import type { SunDay } from './weather';

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

// What the forecast says of the sun on one Household date, as instants (epoch milliseconds). A part it has nothing on is
// left out, and resolveMode and nextBoundary use 7:00 and 19:00 for it.
export type Sun = { sunrise?: number | undefined; sunset?: number | undefined; nextSunrise?: number | undefined };

// The sun of the Household date `now` falls on, from the forecast's days: that day's sunrise and sunset, and the next
// day's sunrise, which is where nextBoundary goes after today's sunset. The days hold instants already (parseForecast reads
// Open-Meteo's text with the offset it answers with), so the Household Timezone only says which date `now` is. A date the
// forecast does not cover has no sun of its own, and Auto then runs on 7:00 and 19:00. A caller asks again at each tick and
// does not keep the answer: the Household date moves on at midnight, and the forecast's days already cover it.
export function sunAt(days: readonly SunDay[], timezone: string, now: number): Sun {
  const date = householdDay(timezone, new Date(now)).date;
  const today = days.find((day) => day.date === date);
  const next = days.find((day) => day.date === addDays(date, 1));
  return {
    ...(today && { sunrise: today.sunrise, sunset: today.sunset }),
    ...(next && { nextSunrise: next.sunrise }),
  };
}

export type ModeInputs = {
  // The Household's Appearance; Auto until the Household has been read.
  appearance?: Appearance | undefined;
  // What this screen's switch set, if it has been used: it wins until the instant it ends.
  override?: ModeOverride | null | undefined;
  now: number;
  // The Household Timezone; null until the Household has been read.
  timezone: string | null;
  // Today's sunrise and sunset, as instants; 7:00 and 19:00 in the Household Timezone when left out.
  sunrise?: number | undefined;
  sunset?: number | undefined;
  // Whether the sun is known yet: the first read of the Household's forecast has finished or failed, or the Household has no
  // weather place, where 7:00 and 19:00 are the sun. Known when left out. Only Auto with no override in force waits for it.
  sunKnown?: boolean | undefined;
  // The mode this screen last resolved (light when it has none): what it keeps while it cannot resolve another.
  last?: Mode | undefined;
};

// An override that has not ended wins; otherwise Light or Dark as the Household set; otherwise Auto, which is
// light from sunrise to sunset. Only that last needs the sun, so only Auto with no override in force waits for it
// (`sunKnown`), keeping the mode the screen last had until it is. Until the Household is read there is nothing to
// resolve with at all, so the screen keeps that mode whatever else is given, and does not flip when the Household arrives.
export function resolveMode({ appearance = 'auto', override, now, timezone, sunrise, sunset, sunKnown = true, last = 'light' }: ModeInputs): Mode {
  if (timezone === null) return last;
  if (override && now < override.until) return override.mode;
  if (appearance !== 'auto') return appearance;
  if (!sunKnown) return last;
  const sun = sunToday(now, timezone, sunrise, sunset);
  return now >= sun.sunrise && now < sun.sunset ? 'light' : 'dark';
}

// Whether the inputs settle on a mode, or leave it to `last`: the Household is read, and something says what the mode is, an
// override that has not ended, Light or Dark, or Auto with the sun known. A screen keeps for its next load only a mode it
// really resolved, so it asks. resolveMode answers with `last` exactly when it cannot say, which is what this goes by: an
// answer that is the same whatever `last` is, is one it gave, so the rule stays in resolveMode and nowhere else.
export function canResolve(inputs: ModeInputs): boolean {
  return resolveMode({ ...inputs, last: 'light' }) === resolveMode({ ...inputs, last: 'dark' });
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

// The longest a stored override may still have to run. The switch sets one that ends at the next sunrise or sunset, which is
// never more than a day away, so one that ends later was written by a wrong clock or by hand, and would hold a mode for days.
export const MAX_OVERRIDE_MS = 24 * 60 * 60 * 1000;

// The switch's override, if it has not ended by `now` and does not end more than a day after it.
export function readOverride(store: ModeStore | null, now: number): ModeOverride | null {
  try {
    const stored = JSON.parse(store?.getItem(OVERRIDE_KEY) ?? 'null') as Partial<ModeOverride> | null;
    const valid =
      stored && (stored.mode === 'light' || stored.mode === 'dark') && typeof stored.until === 'number' && stored.until > now && stored.until - now <= MAX_OVERRIDE_MS;
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

// What a Wall starts from, or goes back to when it stops being a phone: the switch's override that is still running and the mode it
// last resolved. The phone layout (`system`) follows the phone and neither reads nor writes either, so it starts from nothing.
export function storedMode(store: ModeStore | null, system: boolean, now: number): { override: ModeOverride | null; mode: Mode } {
  return system ? { override: null, mode: 'light' } : { override: readOverride(store, now), mode: readLastMode(store) };
}

// What the Wall takes up when its layout changes between the tablet's and the phone's: nothing (null) unless it stops being a phone. Then
// the override is the one the tablet's storage holds that is still running, or, with no storage at all (`store` null), the one the
// screen held in memory (`held`) that has not ended; and the mode is what the inputs resolve to when they can (the Household's Appearance,
// the sun, the Household Timezone and that override), else the override's mode, else the mode last resolved. The phone never writes the
// last mode, so a screen that has never drawn the tablet has none, and the first frame must not be a light one for a dark Wall. It is
// worked out while the screen is drawn, so the tablet's first frame is that mode and the resolving that follows starts from that
// override: it never paints light on the way back, or writes a last mode that ignores the override.
export function modeOnLayoutChange(
  wasSystem: boolean,
  system: boolean,
  store: ModeStore | null,
  now: number,
  settings: Omit<ModeInputs, 'now' | 'override'> = { timezone: null },
  held: ModeOverride | null = null,
): { override: ModeOverride | null; mode: Mode } | null {
  if (!wasSystem || system) return null;
  const stored = storedMode(store, false, now);
  const override = store === null && held && now < held.until ? held : stored.override;
  const inputs: ModeInputs = { ...settings, override, now };
  return { override, mode: canResolve(inputs) ? resolveMode(inputs) : (override?.mode ?? stored.mode) };
}

// One step of keeping the Wall's mode right: what the screen does at the start of a minute. `drop` says the override has run out (and
// is gone from storage); a mode is what resolved (and is kept for the next load); null is nothing to change. The phone layout
// (`system`) never steps: it neither reads nor writes what the Wall stored.
export function stepMode(store: ModeStore | null, system: boolean, override: ModeOverride | null, inputs: ModeInputs): 'drop' | { mode: Mode } | null {
  if (system) return null;
  // An override that has run out is dropped from storage as well as ignored.
  if (override && inputs.now >= override.until) {
    writeOverride(store, null);
    return 'drop';
  }
  // While the inputs cannot resolve a mode the screen keeps the one it has and keeps nothing new for its next load: what it keeps
  // is only what it really resolved.
  if (!canResolve(inputs)) return null;
  const mode = resolveMode(inputs);
  writeLastMode(store, mode);
  return { mode };
}

// Sets the document's mode, and keeps the browser's own idea of it in step: `color-scheme` (form controls,
// scrollbars) and the `theme-color` of the page.
export function applyMode(mode: Mode, doc: Document = document): void {
  doc.documentElement.dataset.mode = mode;
  doc.querySelector('meta[name="color-scheme"]')?.setAttribute('content', mode);
  doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', TOKENS[mode].background);
}
