import { useEffect, useRef, useState } from 'react';
import type { Household } from './household';
import { fetchForecast, forecastToShow, readDelayMs, staleDelayMs, type Forecast, type SunDay, type TemperatureUnit } from './weather';

// The sun of a Wall with no forecast to go on. One array, so what takes it as a dependency sees no change.
const NO_DAYS: SunDay[] = [];

// What the forecast loop says: the forecast the Wall may show (null before a read lands, and with the current conditions
// dropped once the reading is too old) and the days of the last forecast read (those it was given, or none, when no read has landed). It is told only after an attempt.
export type ForecastState = { forecast: Forecast | null; days: SunDay[] };

// The forecast loop for one place (issue #58), plain TypeScript so a test drives it with a fake `fetch` and fake timers. It reads at
// once, every half hour (readDelayMs), and a failed read keeps the last forecast and is tried again sooner, with a longer wait for
// each failure in a row. Once the forecast was read more than two hours ago it no longer claims the current conditions
// (forecastToShow), while the days stay, keyed by date. A timer set for that moment makes it so: every request carries a thirty
// second limit, but without the timer an old temperature would stay up until the next attempt finished, up to a retry delay and
// that limit late. `onChange` is told after each attempt and when the reading turns too old. Returns the function that stops it.
export function startForecast(options: {
  fetch: typeof globalThis.fetch;
  latitude: number;
  longitude: number;
  unit: TemperatureUnit;
  timezone: string;
  // The days a loop before this one read, kept when this one's first read fails: the mode does not flip because the place or unit changed.
  days?: SunDay[] | null;
  onChange: (state: ForecastState) => void;
}): () => void {
  const { latitude, longitude, unit, timezone, onChange } = options;
  let live = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let staleTimer: ReturnType<typeof setTimeout> | undefined;
  let reading: { forecast: Forecast; fetchedAt: number } | null = null;
  let days: SunDay[] | null = options.days ?? null;
  // The failed reads in a row; a good read starts the count again.
  let failures = 0;

  const say = () => onChange({ forecast: reading && forecastToShow(reading.forecast, reading.fetchedAt, Date.now()), days: days ?? NO_DAYS });
  // The moment the reading in hand turns too old, the current conditions go by themselves, even when no attempt finishes to notice.
  const arm = () => {
    clearTimeout(staleTimer);
    if (!reading) return;
    const wait = staleDelayMs(reading.fetchedAt, Date.now());
    if (wait === null) return;
    staleTimer = setTimeout(() => {
      say();
      // A timer that fires a hair early finds the reading still current, and waits out what is left.
      arm();
    }, wait);
  };

  const read = async () => {
    try {
      const next = await fetchForecast(options.fetch, latitude, longitude, unit, timezone);
      failures = 0;
      if (live) {
        reading = { forecast: next, fetchedAt: Date.now() };
        days = next.days;
        arm();
      }
    } catch {
      // Offline or Open-Meteo is down: keep what the Wall shows and try again.
      failures += 1;
      // A first read that failed leaves the mode nothing to wait for: it goes on 7:00 and 19:00.
      if (live) days ??= NO_DAYS;
    }
    if (!live) return;
    say();
    timer = setTimeout(() => void read(), readDelayMs(failures));
  };

  void read();
  return () => {
    live = false;
    clearTimeout(timer);
    clearTimeout(staleTimer);
  };
}

// The forecast for the Household's place (issue #58): nothing, and no request, while it has none. It is read by startForecast
// above, from when the Wall opens, and again when the place, unit or Household Timezone changes. A change of place or unit drops
// the forecast first, since one for another place or unit is a wrong number. Kept out of components/Weather.tsx so that file
// exports only components, which Fast Refresh needs.
//
// It also says what the Wall's mode goes on for the sun (`sun`, src/lib/use-mode.ts): the days of the last forecast
// read, which a change of place or unit does not drop, so the mode does not flip while the new forecast is read.
// null while the Household has a weather place and no read of it has finished or failed, when Auto waits for it (Light,
// Dark and the switch do not); empty when there is no forecast to go on, whether the weather is off or the first read failed.
// The first read always finishes or fails: every request carries a thirty second limit (requestInit), so Auto never
// waits on the mode the screen had for longer than that.
export function useForecast(household: Household | null): { forecast: Forecast | null; sun: SunDay[] | null } {
  const [state, setState] = useState<{ forecast: Forecast | null; days: SunDay[] | null }>({ forecast: null, days: null });
  // The days of the last forecast read, handed to the next loop so a read that fails first does not lose them.
  const kept = useRef<SunDay[] | null>(null);
  // Plain values, not the Household: the Wall reads the Household again every 30 seconds, and a new
  // object with the same place must not mean a new request.
  const latitude = household?.latitude ?? null;
  const longitude = household?.longitude ?? null;
  const unit = household?.temperature_unit ?? null;
  const timezone = household?.timezone ?? null;
  const weatherOn = latitude !== null && longitude !== null && unit !== null && timezone !== null;

  useEffect(() => {
    setState((was) => (was.forecast === null ? was : { ...was, forecast: null }));
    if (!weatherOn) return;
    return startForecast({
      fetch: globalThis.fetch.bind(globalThis),
      latitude,
      longitude,
      unit,
      timezone,
      days: kept.current,
      onChange: (next) => {
        kept.current = next.days;
        setState(next);
      },
    });
  }, [weatherOn, latitude, longitude, unit, timezone]);

  return { forecast: state.forecast, sun: weatherOn ? state.days : NO_DAYS };
}
