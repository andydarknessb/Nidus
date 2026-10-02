import { useEffect, useState } from 'react';
import type { Household } from './household';
import { fetchForecast, forecastToShow, readDelayMs, staleDelayMs, type Forecast } from './weather';

// A forecast and when it landed, so a reading left standing by an outage stops passing as current.
type Reading = { forecast: Forecast; fetchedAt: number };

// The forecast for the Household's place (issue #58): nothing, and no request, while it has none.
// It is read when the Wall opens, every half hour (readDelayMs), and again when the place, unit or
// Household Timezone changes. A failed read keeps the last forecast and is tried again sooner, with
// a longer wait for each failure in a row; once the forecast was read more than two hours ago it no
// longer claims the current conditions (forecastToShow), while the days stay, keyed by date. A
// timer set for that moment makes it so, rather than the next attempt finishing, which a request
// that never settles would put off for good. A change of place or unit drops the forecast first,
// since one for another place or unit is a wrong number. Kept out of components/Weather.tsx so that
// file exports only components, which Fast Refresh needs.
export function useForecast(household: Household | null): Forecast | null {
  const [reading, setReading] = useState<Reading | null>(null);
  // The clock as of the latest attempt to read, or of the reading in hand turning too old (the timer
  // below): what forecastToShow judges the reading's age against. Failed attempts move it on too.
  const [now, setNow] = useState(() => Date.now());
  // Plain values, not the Household: the Wall reads the Household again every 30 seconds, and a new
  // object with the same place must not mean a new request.
  const latitude = household?.latitude ?? null;
  const longitude = household?.longitude ?? null;
  const unit = household?.temperature_unit ?? null;
  const timezone = household?.timezone ?? null;

  useEffect(() => {
    setReading(null);
    if (latitude === null || longitude === null || unit === null || timezone === null) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // The failed reads in a row; a good read starts the count again.
    let failures = 0;
    const read = async () => {
      try {
        const next = await fetchForecast(latitude, longitude, unit, timezone);
        failures = 0;
        if (live) setReading({ forecast: next, fetchedAt: Date.now() });
      } catch {
        // Offline or Open-Meteo is down: keep what the Wall shows and try again.
        failures += 1;
      }
      if (!live) return;
      setNow(Date.now());
      timer = setTimeout(() => void read(), readDelayMs(failures));
    };

    void read();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [latitude, longitude, unit, timezone]);

  // The moment the reading in hand turns too old, `now` moves on to it by itself, so the current
  // conditions go on time even when no attempt finishes to notice: a WebView without
  // AbortSignal.timeout sends no limit, and a request that leads nowhere would otherwise leave an old
  // temperature up for good. A newer reading sets its own timer and this one is cleared, as it is when
  // the Wall closes or the place changes and the reading is dropped.
  useEffect(() => {
    if (reading === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      const wait = staleDelayMs(reading.fetchedAt, Date.now());
      if (wait === null) return;
      timer = setTimeout(() => {
        setNow(Date.now());
        // A timer that fires a hair early finds the reading still current, and waits out what is left.
        arm();
      }, wait);
    };
    arm();
    return () => clearTimeout(timer);
  }, [reading]);

  return reading && forecastToShow(reading.forecast, reading.fetchedAt, now);
}
