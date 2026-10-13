import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startForecast, type ForecastState } from '../src/lib/use-forecast';
import { CURRENT_MAX_AGE_MS, parseForecast } from '../src/lib/weather';
import { fakeOpenMeteo, recorded, type OpenMeteoFixtures } from './support/open-meteo';

// The forecast loop (issue #58, spec 0012) through its plain core, with a fake Open-Meteo and fake timers: its cadence, its
// backoff and the moment a reading stops being called current.
const MINUTE = 60_000;
const forecast = recorded('open-meteo-forecast');

function harness(fixtures: OpenMeteoFixtures, fetchOf: (fetch: typeof globalThis.fetch) => typeof globalThis.fetch = (fetch) => fetch) {
  const open = fakeOpenMeteo(fixtures);
  const states: ForecastState[] = [];
  const stop = startForecast({
    fetch: fetchOf(open.fetch),
    latitude: 30.27,
    longitude: -97.74,
    unit: 'fahrenheit',
    timezone: 'America/Chicago',
    onChange: (state) => states.push(state),
  });
  const last = () => states[states.length - 1];
  return { ...open, states, last, stop };
}

describe('startForecast', () => {
  beforeEach(() => vi.useFakeTimers({ now: Date.parse('2026-10-01T20:30:00Z') }));
  afterEach(() => vi.useRealTimers());

  it('reads at once, asking for the place, unit and Household Timezone, and says the forecast and its days', async () => {
    const { calls, last, stop } = harness({ forecast });
    await vi.advanceTimersByTimeAsync(0);

    expect(calls).toHaveLength(1);
    expect(Object.fromEntries(calls[0]!.url.searchParams)).toMatchObject({
      latitude: '30.27',
      longitude: '-97.74',
      temperature_unit: 'fahrenheit',
      timezone: 'America/Chicago',
    });
    expect(last()?.forecast?.current).toEqual({ temperature: 76, code: 80, isDay: true });
    expect(last()?.days).toHaveLength(7);
    stop();
  });

  it('a failed first read keeps the days it was given', async () => {
    const given = parseForecast(forecast).days;
    const states: ForecastState[] = [];
    const stop = startForecast({
      fetch: fakeOpenMeteo({ forecast: 503 }).fetch,
      latitude: 30.27,
      longitude: -97.74,
      unit: 'celsius',
      timezone: 'America/Chicago',
      days: given,
      onChange: (state) => states.push(state),
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(states.at(-1)).toEqual({ forecast: null, days: given });
    stop();
  });

  it('reads again every half hour', async () => {
    const { calls, stop } = harness({ forecast });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30 * MINUTE - 1);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    stop();
  });

  it('with the first read failed, says no days and no forecast, and tries again in a minute, then two, then four', async () => {
    const { calls, last, stop } = harness({ forecast: 503 });
    await vi.advanceTimersByTimeAsync(0);
    expect(last()).toEqual({ forecast: null, days: [] });

    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2 * MINUTE - 1);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(4 * MINUTE);
    expect(calls).toHaveLength(4);
    stop();
  });

  it('starts the backoff over after a good read', async () => {
    const fixtures: OpenMeteoFixtures = { forecast: null };
    const { calls, last, stop } = harness(fixtures);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(calls).toHaveLength(2);

    fixtures.forecast = forecast;
    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    expect(calls).toHaveLength(3);
    expect(last()?.forecast).not.toBeNull();

    // A good read waits the half hour, not the minute.
    await vi.advanceTimersByTimeAsync(29 * MINUTE);
    expect(calls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(calls).toHaveLength(4);
    stop();
  });

  it('keeps the last forecast and its days through a failed read', async () => {
    const fixtures: OpenMeteoFixtures = { forecast };
    const { last, stop } = harness(fixtures);
    await vi.advanceTimersByTimeAsync(0);
    const kept = last()?.forecast;
    expect(kept).not.toBeNull();

    fixtures.forecast = 500;
    await vi.advanceTimersByTimeAsync(30 * MINUTE);
    expect(last()?.forecast).toEqual(kept);
    expect(last()?.days).toHaveLength(7);
    stop();
  });

  it('drops the current conditions, and only them, once the reading is more than two hours old, on time and with no read finishing', async () => {
    // Every read after the first never answers (a connection that leads nowhere).
    let first = true;
    const { last, stop } = harness({ forecast }, (fetch) => (input, init) => {
      if (!first) return new Promise<Response>(() => undefined);
      first = false;
      return fetch(input, init);
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(last()?.forecast?.current).not.toBeNull();

    await vi.advanceTimersByTimeAsync(CURRENT_MAX_AGE_MS);
    expect(last()?.forecast?.current).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(last()?.forecast?.current).toBeNull();
    expect(last()?.forecast?.days).toHaveLength(7);
    stop();
  });

  it('says nothing and asks for nothing once stopped', async () => {
    const { calls, states, stop } = harness({ forecast });
    await vi.advanceTimersByTimeAsync(0);
    const told = states.length;
    stop();
    await vi.advanceTimersByTimeAsync(CURRENT_MAX_AGE_MS + 31 * MINUTE);
    expect(calls).toHaveLength(1);
    expect(states).toHaveLength(told);
  });
});
