import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { watchMinute } from './household-day';
import type { Mode } from './look';
import { applyMode, localStore, nextBoundary, readLastMode, readOverride, resolveMode, sunAt, writeLastMode, writeOverride, type Appearance, type ModeOverride } from './mode';
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
  // null while the Household has a weather place and the first read of its forecast has not finished or failed.
  sun: readonly SunDay[] | null;
};

// Keeps the document's mode right on the Wall: the mode the screen last resolved until it knows (the Household is read
// and, when it has a weather place, its forecast has been read or has failed), then the switch's override while it lasts,
// else the Household's Appearance, which for Auto is light from sunrise to sunset. It moves at a boundary (sunrise,
// sunset, the end of an override) at the start of the minute it falls in, with no reload, and it keeps what it resolved
// for the next load to paint. The sun is read from the forecast at each minute and not once, so the Household date
// moving on at midnight needs no new render. Returns the switch: it sets an override for the opposite mode that lasts
// until the next sunrise or sunset, on this screen only. It does nothing until the screen knows, since that is what
// says when the next one is.
export function useWallMode({ timezone, appearance, sun }: WallModeSettings): () => void {
  const [store] = useState(localStore);
  const [override, setOverride] = useState(() => readOverride(store, Date.now()));
  // What the screen shows is the mode it last resolved, which is the one it is kept in until it knows.
  const [mode, setMode] = useState<Mode>(() => readLastMode(store));
  const known = timezone !== null && sun !== null;

  useEffect(() => {
    const resolve = () => {
      const now = Date.now();
      // An override that has run out is dropped from storage as well as ignored.
      if (override && now >= override.until) {
        writeOverride(store, null);
        setOverride(null);
        return;
      }
      // Before it knows, resolveMode keeps the mode the screen has: it is given as `last`.
      const inputs = timezone !== null && sun !== null ? { timezone, ...sunAt(sun, timezone, now) } : { timezone: null };
      setMode((current) => resolveMode({ appearance, override, now, last: current, ...inputs }));
    };
    resolve();
    return watchMinute(resolve);
  }, [store, appearance, override, timezone, sun]);

  useEffect(() => {
    applyMode(mode);
    // What the screen last resolved is what the next load paints; before it knows it has resolved nothing.
    if (known) writeLastMode(store, mode);
  }, [store, mode, known]);

  return useCallback(() => {
    if (timezone === null || sun === null) return;
    const now = Date.now();
    const next: ModeOverride = { mode: mode === 'dark' ? 'light' : 'dark', until: nextBoundary({ now, timezone, ...sunAt(sun, timezone, now) }) };
    writeOverride(store, next);
    setOverride(next);
  }, [store, mode, timezone, sun]);
}

// The phone's pages follow the phone: prefers-color-scheme, and light when it says nothing. They change when it
// does, and they neither read nor write what the Wall stored.
const PREFERS_DARK = '(prefers-color-scheme: dark)';

export function useSystemMode(): void {
  const dark = useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(PREFERS_DARK);
      query.addEventListener('change', notify);
      return () => query.removeEventListener('change', notify);
    },
    () => window.matchMedia(PREFERS_DARK).matches,
  );
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
