import { useEffect, useState } from 'react';
import type { Household } from './household';
import { fetchForecast, forecastToShow, type Forecast } from './weather';

// A forecast moves slowly and Open-Meteo is a free service, so the Wall asks every half hour.
const REFRESH_MS = 30 * 60_000;
// After a failed read it asks sooner, so a Wall that woke before its Wi-Fi does not wait half an hour.
const RETRY_MS = 60_000;

// A forecast and when it landed, so a reading left standing by an outage stops passing as current.
type Reading = { forecast: Forecast; fetchedAt: number };

// The forecast for the Household's place (issue #58): nothing, and no request, while it has none.
// It is read when the Wall opens, every half hour, and again when the place, unit or Household
// Timezone changes. A failed read keeps the last forecast, but once that was read more than two
// hours ago it no longer claims the current conditions (forecastToShow); the days stay, keyed by
// date. A change of place or unit drops the forecast first, since one for another place or unit is
// a wrong number. Kept out of components/Weather.tsx so that file exports only components, which
// Fast Refresh needs.
export function useForecast(household: Household | null): Forecast | null {
  const [reading, setReading] = useState<Reading | null>(null);
  // The clock as of the latest attempt to read. Failed attempts move it on too, so an outage is
  // noticed within a retry of the reading going stale.
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

    const read = async () => {
      let delay = REFRESH_MS;
      try {
        const next = await fetchForecast(latitude, longitude, unit, timezone);
        if (live) setReading({ forecast: next, fetchedAt: Date.now() });
      } catch {
        // Offline or Open-Meteo is down: keep what the Wall shows and try again sooner.
        delay = RETRY_MS;
      }
      if (!live) return;
      setNow(Date.now());
      timer = setTimeout(() => void read(), delay);
    };

    void read();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [latitude, longitude, unit, timezone]);

  return reading && forecastToShow(reading.forecast, reading.fetchedAt, now);
}
