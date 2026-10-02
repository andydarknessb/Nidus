import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { watchMinute } from './household-day';
import type { Mode } from './look';
import { applyMode, localStore, nextBoundary, readLastMode, readOverride, resolveMode, writeLastMode, writeOverride, type ModeInputs, type ModeOverride } from './mode';

// What a screen's mode follows as time passes. The logic is src/lib/mode.ts's, which is pure and tested; this file
// is the React that runs it. Kept out of mode.ts so that file needs no DOM to be tested.

// What the Household says about the mode, so far as the Wall knows it. Only `timezone` is needed while the
// Appearance is always Auto and the sun is the fallback hours; the rest is for the ticket that reads them.
export type WallModeSettings = Omit<ModeInputs, 'now' | 'override' | 'last'> & { nextSunrise?: number | undefined };

// Keeps the document's mode right on the Wall: the mode the screen last resolved until the Household is read,
// then Auto, or the Household's Appearance, or the switch's override while it lasts. It moves at a boundary
// (sunrise, sunset, the end of an override) at the start of the minute it falls in, with no reload, and it keeps
// what it resolved for the next load to paint. Returns the switch: it sets an override for the opposite mode that
// lasts until the next sunrise or sunset, on this screen only. It does nothing until the Household is read, since
// that is what says when the next one is.
export function useWallMode({ timezone, appearance, sunrise, sunset, nextSunrise }: WallModeSettings): () => void {
  const [store] = useState(localStore);
  const [last] = useState(() => readLastMode(store));
  const [override, setOverride] = useState(() => readOverride(store, Date.now()));
  const [mode, setMode] = useState<Mode>(last);

  useEffect(() => {
    const resolve = () => {
      const now = Date.now();
      // An override that has run out is dropped from storage as well as ignored.
      if (override && now >= override.until) {
        writeOverride(store, null);
        setOverride(null);
        return;
      }
      setMode(resolveMode({ appearance, override, now, timezone, sunrise, sunset, last }));
    };
    resolve();
    return watchMinute(resolve);
  }, [store, appearance, override, timezone, sunrise, sunset, last]);

  useEffect(() => {
    applyMode(mode);
    // What the screen last resolved is what the next load paints; before the Household is read it has resolved nothing.
    if (timezone !== null) writeLastMode(store, mode);
  }, [store, mode, timezone]);

  return useCallback(() => {
    if (timezone === null) return;
    const next: ModeOverride = { mode: mode === 'dark' ? 'light' : 'dark', until: nextBoundary({ now: Date.now(), timezone, sunrise, sunset, nextSunrise }) };
    writeOverride(store, next);
    setOverride(next);
  }, [store, mode, timezone, sunrise, sunset, nextSunrise]);
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

// The pairing screen is always light, and so is the next load: a tablet with no Household has resolved nothing.
export function useLightMode(): void {
  useEffect(() => {
    applyMode('light');
    writeLastMode(localStore(), 'light');
  }, []);
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
