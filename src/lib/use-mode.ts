import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { watchMinute } from './household-day';
import type { Mode } from './look';
import { applyMode, canResolve, localStore, nextBoundary, readLastMode, readOverride, resolveMode, sunAt, writeLastMode, writeOverride, type Appearance, type ModeOverride } from './mode';
import type { SunDay } from './weather';

// What a screen's mode follows as time passes. The logic is src/lib/mode.ts's, which is pure and tested; this file
// is the React that runs it. Kept out of mode.ts so that file needs no DOM to be tested.

// What the Household says about the mode, so far as the Wall knows it.
export type WallModeSettings = {
  // The Household Timezone; null until the Household has been read.
  timezone: string | null;
  // The Household's Appearance; Auto until the Household has been read.
  appearance?: Appearance | undefined;
  // The forecast's days, which Auto takes its sunrise and sunset from (src/lib/use-forecast.ts). Empty when there is no
  // forecast to go on, the weather being off or its first read having failed: Auto is then light from 7:00 to 19:00.
  // null while the Household has a weather place and the first read of its forecast has not finished or failed: the sun is
  // not known yet, and Auto waits for it. Light, Dark and the switch do not.
  sun: readonly SunDay[] | null;
  // The phone layout (below 768 px wide, src/lib/home-layout.ts): the mode is the phone's own, as useSystemMode makes it, and
  // the Household's Appearance, the switch's override and what the Wall last resolved play no part: none is read and none is
  // written. Hooks cannot be conditional, so a Wall that crosses 768 px by resizing keeps this one and flips this input;
  // false (or left out) is the tablet's behaviour exactly.
  system?: boolean | undefined;
};

// Keeps the document's mode right on the Wall: the switch's override while it lasts, else the Household's Appearance, which
// for Auto is light from sunrise to sunset. The rule is resolveMode's, which this only feeds: while it cannot say, the
// Household not being read yet or Auto waiting for the sun, the screen keeps the mode it last resolved. It moves at a boundary
// (sunrise, sunset, the end of an override) at the start of the minute it falls in, with no reload, and it keeps what it
// resolved for the next load to paint. The sun is read from the forecast at each minute and not once, so the Household date
// moving on at midnight needs no new render. Returns the switch: it sets an override for the opposite mode that lasts until
// the next sunrise or sunset, on this screen only. It works as soon as the Household is read.
export function useWallMode({ timezone, appearance, sun, system = false }: WallModeSettings): () => void {
  const [store] = useState(localStore);
  const [override, setOverride] = useState(() => (system ? null : readOverride(store, Date.now())));
  // What the screen shows is the mode it last resolved, until it resolves another.
  const [mode, setMode] = useState<Mode>(() => (system ? 'light' : readLastMode(store)));
  const prefersDark = usePrefersDark();

  useEffect(() => {
    // The phone's mode is the effect below's, and this one reads and writes nothing.
    if (system) return;
    const resolve = () => {
      const now = Date.now();
      // An override that has run out is dropped from storage as well as ignored.
      if (override && now >= override.until) {
        writeOverride(store, null);
        setOverride(null);
        return;
      }
      const inputs = { appearance, override, now, timezone, sunKnown: sun !== null, ...(timezone !== null ? sunAt(sun ?? [], timezone, now) : {}) };
      // While the inputs cannot resolve a mode the screen keeps the one it has and keeps nothing new for its next load: what
      // it keeps is only what it really resolved.
      if (!canResolve(inputs)) return;
      const resolved = resolveMode(inputs);
      setMode(resolved);
      writeLastMode(store, resolved);
    };
    resolve();
    return watchMinute(resolve);
  }, [store, appearance, override, timezone, sun, system]);

  const shown: Mode = system ? (prefersDark ? 'dark' : 'light') : mode;
  useEffect(() => applyMode(shown), [shown]);

  return useCallback(() => {
    // The phone has no switch.
    if (system || timezone === null) return;
    // The override ends at the next boundary from what the screen has now: the forecast's sun when it is known, else 7:00 and 19:00.
    const now = Date.now();
    const next: ModeOverride = { mode: mode === 'dark' ? 'light' : 'dark', until: nextBoundary({ now, timezone, ...sunAt(sun ?? [], timezone, now) }) };
    writeOverride(store, next);
    setOverride(next);
  }, [store, mode, timezone, sun, system]);
}

// The phone's pages follow the phone: prefers-color-scheme, and light when it says nothing. They change when it
// does, and they neither read nor write what the Wall stored.
const PREFERS_DARK = '(prefers-color-scheme: dark)';

// Whether the phone prefers dark now, and drawn again when it changes.
function usePrefersDark(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(PREFERS_DARK);
      query.addEventListener('change', notify);
      return () => query.removeEventListener('change', notify);
    },
    () => window.matchMedia(PREFERS_DARK).matches,
  );
}

export function useSystemMode(): void {
  const dark = usePrefersDark();
  useEffect(() => applyMode(dark ? 'dark' : 'light'), [dark]);
}

// The pairing screen is always light. What the next load paints is stored by WallPage the moment it learns the tablet is
// unpaired, which is earlier than this screen can mount: it waits for a code.
export function useLightMode(): void {
  useEffect(() => applyMode('light'), []);
}

// The mode the document is in, for the rare component that must draw something other than a colour by it, such as
// an icon. Colour never branches on it: the tokens already differ by mode.
export function useMode(): Mode {
  return useSyncExternalStore(
    (notify) => {
      const observer = new MutationObserver(notify);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] });
      return () => observer.disconnect();
    },
    () => (document.documentElement.dataset.mode === 'dark' ? 'dark' : 'light'),
  );
}
