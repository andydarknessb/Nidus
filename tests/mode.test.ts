import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { TOKENS } from '../src/lib/look';
import { MAX_OVERRIDE_MS, MODE_KEY, OVERRIDE_KEY, nextBoundary, readLastMode, readOverride, resolveMode, sunAt, writeLastMode, writeOverride, type Appearance, type ModeStore } from '../src/lib/mode';
import type { SunDay } from '../src/lib/weather';

// Every instant is written in UTC and every Household Timezone is named, so no test reads the machine's zone.
const at = (iso: string) => Date.parse(`${iso}Z`);
const CHICAGO = 'America/Chicago';

describe('resolveMode: Auto, with no sunrise and sunset to go on', () => {
  // 2026-10-01 in Chicago is on daylight time (UTC-5): 7:00 is 12:00 UTC and 19:00 is 00:00 UTC the next day.
  it('is light from 7:00 to 19:00 Household time and dark otherwise, changing over at the minute', () => {
    const mode = (iso: string) => resolveMode({ now: at(iso), timezone: CHICAGO });
    expect(mode('2026-10-01T11:59:59.999')).toBe('dark');
    expect(mode('2026-10-01T12:00:00.000')).toBe('light');
    expect(mode('2026-10-01T18:00:00')).toBe('light');
    expect(mode('2026-10-01T23:59:59.999')).toBe('light');
    expect(mode('2026-10-02T00:00:00.000')).toBe('dark');
    expect(mode('2026-10-02T09:00:00')).toBe('dark');
  });

  it("is in the Household Timezone, whatever zone the machine is in", () => {
    // 12:30 UTC is 7:30 in Chicago, 21:30 in Tokyo and 2:30 in Honolulu.
    const now = at('2026-10-01T12:30:00');
    expect(resolveMode({ now, timezone: CHICAGO })).toBe('light');
    expect(resolveMode({ now, timezone: 'Asia/Tokyo' })).toBe('dark');
    expect(resolveMode({ now, timezone: 'Pacific/Honolulu' })).toBe('dark');
    // 22:00 UTC the day before is 7:00 on Tokyo's wall clock.
    expect(resolveMode({ now: at('2026-09-30T22:00:00'), timezone: 'Asia/Tokyo' })).toBe('light');
    expect(resolveMode({ now: at('2026-09-30T21:59:59.999'), timezone: 'Asia/Tokyo' })).toBe('dark');
  });

  it('follows the clock across a daylight saving change: 7:00 and 19:00 move in UTC and not on the wall', () => {
    const mode = (iso: string) => resolveMode({ now: at(iso), timezone: CHICAGO });
    // Spring forward, Sunday 2026-03-08 (a 23 hour day): 7:00 is 12:00 UTC, not the 13:00 of the day before.
    expect(mode('2026-03-07T12:59:00')).toBe('dark');
    expect(mode('2026-03-07T13:00:00')).toBe('light');
    expect(mode('2026-03-08T11:59:00')).toBe('dark');
    expect(mode('2026-03-08T12:00:00')).toBe('light');
    expect(mode('2026-03-08T23:59:00')).toBe('light');
    expect(mode('2026-03-09T00:00:00')).toBe('dark');
    // Fall back, Sunday 2026-11-01 (a 25 hour day): 7:00 is 13:00 UTC, not the 12:00 of the day before.
    expect(mode('2026-10-31T11:59:00')).toBe('dark');
    expect(mode('2026-10-31T12:00:00')).toBe('light');
    expect(mode('2026-11-01T12:59:00')).toBe('dark');
    expect(mode('2026-11-01T13:00:00')).toBe('light');
    expect(mode('2026-11-02T00:59:00')).toBe('light');
    expect(mode('2026-11-02T01:00:00')).toBe('dark');
  });
});

describe('resolveMode: sunrise and sunset', () => {
  // Today's sunrise at 6:12 and sunset at 19:48 in Chicago.
  const sun = { sunrise: at('2026-10-01T11:12:00'), sunset: at('2026-10-02T00:48:00') };

  it('uses them in place of 7:00 and 19:00', () => {
    const mode = (iso: string) => resolveMode({ now: at(iso), timezone: CHICAGO, ...sun });
    expect(mode('2026-10-01T11:11:59.999')).toBe('dark');
    expect(mode('2026-10-01T11:12:00')).toBe('light');
    expect(mode('2026-10-01T12:00:00')).toBe('light');
    expect(mode('2026-10-02T00:47:59.999')).toBe('light');
    expect(mode('2026-10-02T00:48:00')).toBe('dark');
  });

  it('can be given one at a time, the other keeping its fallback hour', () => {
    // Sunrise given: 6:12 local, and the 19:00 default sunset.
    expect(resolveMode({ now: at('2026-10-01T11:30:00'), timezone: CHICAGO, sunrise: sun.sunrise })).toBe('light');
    expect(resolveMode({ now: at('2026-10-01T23:59:00'), timezone: CHICAGO, sunrise: sun.sunrise })).toBe('light');
    expect(resolveMode({ now: at('2026-10-02T00:00:00'), timezone: CHICAGO, sunrise: sun.sunrise })).toBe('dark');
    // Sunset given: 19:48 local, and the 7:00 default sunrise.
    expect(resolveMode({ now: at('2026-10-01T11:59:00'), timezone: CHICAGO, sunset: sun.sunset })).toBe('dark');
    expect(resolveMode({ now: at('2026-10-02T00:30:00'), timezone: CHICAGO, sunset: sun.sunset })).toBe('light');
  });
});

describe('resolveMode: the Appearance', () => {
  it('Light and Dark hold at any hour', () => {
    for (const iso of ['2026-10-01T04:00:00', '2026-10-01T18:00:00']) {
      expect(resolveMode({ now: at(iso), timezone: CHICAGO, appearance: 'light' })).toBe('light');
      expect(resolveMode({ now: at(iso), timezone: CHICAGO, appearance: 'dark' })).toBe('dark');
    }
  });

  it('Auto is the default', () => {
    expect(resolveMode({ now: at('2026-10-01T18:00:00'), timezone: CHICAGO, appearance: 'auto' })).toBe('light');
    expect(resolveMode({ now: at('2026-10-01T04:00:00'), timezone: CHICAGO })).toBe('dark');
  });
});

// ---- The forecast's sunrise and sunset ----------------------------------------------------------
// The Wall holds the forecast's days as src/lib/weather.ts reads them: each day's Household date, and its sunrise and sunset as
// instants (Open-Meteo sends wall-clock text at one offset for the whole answer, and parseForecast turns it into the instant it
// is). sunAt() picks the ones of the Household date `now` falls on. Chicago is on daylight time (UTC-5) from 2026-03-08 to
// 2026-11-01 and on standard time (UTC-6) outside that.
const OCTOBER: SunDay[] = [
  { date: '2026-10-01', sunrise: at('2026-10-01T12:12:00'), sunset: at('2026-10-01T23:48:00') }, // 07:12 and 18:48 in Chicago
  { date: '2026-10-02', sunrise: at('2026-10-02T12:13:00'), sunset: at('2026-10-02T23:46:00') },
  { date: '2026-10-03', sunrise: at('2026-10-03T12:14:00'), sunset: at('2026-10-03T23:45:00') },
];
// The days either side of the spring change (Sunday 2026-03-08, 23 hours).
const SPRING: SunDay[] = [
  { date: '2026-03-07', sunrise: at('2026-03-07T12:27:00'), sunset: at('2026-03-08T00:09:00') }, // 06:27 and 18:09 on standard time
  { date: '2026-03-08', sunrise: at('2026-03-08T12:26:00'), sunset: at('2026-03-09T00:10:00') }, // 07:26 and 19:10 on daylight time
];
// The days around the clocks going back in Chicago (Sunday 2025-11-02, 25 hours), with the sunrises Open-Meteo gave for Austin:
// 7:45 AM on the 1st, on daylight time, and 6:46 AM on the 2nd, on standard time. Its text for the 2nd said 07:46, at the
// answer's one offset, so the sunrise is the 6:46 AM of the Household's clock and never a 7:46 (tests/weather.test.ts).
const FALL: SunDay[] = [
  { date: '2025-11-01', sunrise: 1762001100000, sunset: at('2025-11-01T23:44:00') },
  { date: '2025-11-02', sunrise: 1762087560000, sunset: at('2025-11-02T23:43:00') },
  { date: '2025-11-03', sunrise: at('2025-11-03T12:46:00'), sunset: at('2025-11-03T23:42:00') },
];

describe("sunAt: the forecast's sun for the Household date", () => {
  it("is the sunrise and sunset of the Household's date, and the next day's sunrise", () => {
    expect(sunAt(OCTOBER, CHICAGO, at('2026-10-01T15:00:00'))).toEqual({
      sunrise: at('2026-10-01T12:12:00'),
      sunset: at('2026-10-01T23:48:00'),
      nextSunrise: at('2026-10-02T12:13:00'),
    });
  });

  it("goes by the Household's date, which is not the UTC date for hours of the evening, and by the Household Timezone's", () => {
    // 02:00 UTC on the 2nd is 21:00 on the 1st in Chicago.
    expect(sunAt(OCTOBER, CHICAGO, at('2026-10-02T02:00:00'))).toMatchObject({ sunrise: at('2026-10-01T12:12:00') });
    // 05:00 UTC is the Household's midnight: the 2nd begins, and with it the 2nd's sun.
    expect(sunAt(OCTOBER, CHICAGO, at('2026-10-02T04:59:59.999'))).toMatchObject({ sunrise: at('2026-10-01T12:12:00') });
    expect(sunAt(OCTOBER, CHICAGO, at('2026-10-02T05:00:00'))).toMatchObject({ sunrise: at('2026-10-02T12:13:00'), sunset: at('2026-10-02T23:46:00') });
    // The same instant is 11:00 on the 2nd in Tokyo: that Household is on the 2nd already.
    expect(sunAt(OCTOBER, 'Asia/Tokyo', at('2026-10-02T02:00:00'))).toMatchObject({ sunrise: at('2026-10-02T12:13:00') });
  });

  it('gives the instants as they are: the Household Timezone only says which date it is', () => {
    const now = at('2026-10-01T15:00:00');
    expect(sunAt(OCTOBER, 'America/Denver', now)).toEqual(sunAt(OCTOBER, CHICAGO, now));
  });

  it('has none for a date the forecast does not cover, and none at all without a forecast', () => {
    expect(sunAt(OCTOBER, CHICAGO, at('2026-10-05T15:00:00'))).toEqual({});
    expect(sunAt([], CHICAGO, at('2026-10-01T15:00:00'))).toEqual({});
  });

  it("still has the next day's sunrise when only the next day is covered", () => {
    // 2026-09-30 is the day before the forecast starts.
    expect(sunAt(OCTOBER, CHICAGO, at('2026-09-30T15:00:00'))).toEqual({ nextSunrise: at('2026-10-01T12:12:00') });
  });

  it("has no next sunrise on the forecast's last day", () => {
    expect(sunAt(OCTOBER, CHICAGO, at('2026-10-03T15:00:00'))).toEqual({ sunrise: at('2026-10-03T12:14:00'), sunset: at('2026-10-03T23:45:00') });
  });

  it("turns the Household date over at the Household's midnight on the 25 hour day the clocks go back", () => {
    // The clocks go back at 02:00 on the 2nd: the midnight that starts it is 05:00 UTC (daylight time) and the one that ends it
    // is 06:00 UTC on the 3rd (standard time), 25 hours on.
    expect(sunAt(FALL, CHICAGO, at('2025-11-02T04:59:59.999')).sunrise).toBe(1762001100000);
    expect(sunAt(FALL, CHICAGO, at('2025-11-02T05:00:00')).sunrise).toBe(1762087560000);
    expect(sunAt(FALL, CHICAGO, at('2025-11-03T05:59:59.999')).sunrise).toBe(1762087560000);
    expect(sunAt(FALL, CHICAGO, at('2025-11-03T06:00:00')).sunrise).toBe(at('2025-11-03T12:46:00'));
    // And the 2nd has the 3rd's sunrise to come.
    expect(sunAt(FALL, CHICAGO, at('2025-11-02T18:00:00'))).toEqual({
      sunrise: 1762087560000,
      sunset: at('2025-11-02T23:43:00'),
      nextSunrise: at('2025-11-03T12:46:00'),
    });
  });

  it("turns the Household date over at the Household's midnight on the 23 hour day the clocks go forward", () => {
    // The midnight that starts the 8th is 06:00 UTC (standard time) and the one that ends it is 05:00 UTC on the 9th (daylight
    // time), 23 hours on.
    expect(sunAt(SPRING, CHICAGO, at('2026-03-08T05:59:59.999')).sunrise).toBe(at('2026-03-07T12:27:00'));
    expect(sunAt(SPRING, CHICAGO, at('2026-03-08T06:00:00')).sunrise).toBe(at('2026-03-08T12:26:00'));
    expect(sunAt(SPRING, CHICAGO, at('2026-03-09T04:59:59.999')).sunrise).toBe(at('2026-03-08T12:26:00'));
    // The 9th is past the days it holds.
    expect(sunAt(SPRING, CHICAGO, at('2026-03-09T05:00:00'))).toEqual({});
  });
});

describe('resolveMode: the Appearance with the forecast\'s sun, without one, and on a daylight saving change', () => {
  const mode = (iso: string, appearance: Appearance, days: SunDay[]) =>
    resolveMode({ now: at(iso), timezone: CHICAGO, appearance, ...sunAt(days, CHICAGO, at(iso)) });

  it('Auto is light from the forecast\'s sunrise to its sunset and dark either side, changing over at the minute', () => {
    // 07:12 and 18:48 in Chicago on 2026-10-01.
    expect(mode('2026-10-01T12:11:59.999', 'auto', OCTOBER)).toBe('dark');
    expect(mode('2026-10-01T12:12:00', 'auto', OCTOBER)).toBe('light');
    expect(mode('2026-10-01T23:47:59.999', 'auto', OCTOBER)).toBe('light');
    expect(mode('2026-10-01T23:48:00', 'auto', OCTOBER)).toBe('dark');
    // Not the 7:00 and 19:00 it would use without a forecast: 12:05 UTC is 07:05 and is still dark by the sun.
    expect(mode('2026-10-01T12:05:00', 'auto', OCTOBER)).toBe('dark');
    expect(mode('2026-10-01T23:55:00', 'auto', OCTOBER)).toBe('dark');
  });

  it('Light and Dark hold at any hour, with the forecast and without it', () => {
    for (const days of [OCTOBER, []]) {
      for (const iso of ['2026-10-01T05:00:00', '2026-10-01T12:11:59.999', '2026-10-01T12:12:00', '2026-10-01T18:00:00', '2026-10-01T23:47:59.999', '2026-10-01T23:48:00', '2026-10-02T03:00:00']) {
        expect(mode(iso, 'light', days), `Light at ${iso}`).toBe('light');
        expect(mode(iso, 'dark', days), `Dark at ${iso}`).toBe('dark');
      }
    }
  });

  it('Auto falls back to 7:00 and 19:00 with no forecast at all', () => {
    expect(mode('2026-10-01T11:59:59.999', 'auto', [])).toBe('dark');
    expect(mode('2026-10-01T12:00:00', 'auto', [])).toBe('light');
    expect(mode('2026-10-01T23:59:59.999', 'auto', [])).toBe('light');
    expect(mode('2026-10-02T00:00:00', 'auto', [])).toBe('dark');
  });

  it('Auto falls back to 7:00 and 19:00 when the forecast does not cover the date', () => {
    // Oct 5 is past the forecast's last day: the same hours as with none.
    expect(mode('2026-10-05T11:59:59.999', 'auto', OCTOBER)).toBe('dark');
    expect(mode('2026-10-05T12:00:00', 'auto', OCTOBER)).toBe('light');
    expect(mode('2026-10-05T23:59:59.999', 'auto', OCTOBER)).toBe('light');
    expect(mode('2026-10-06T00:00:00', 'auto', OCTOBER)).toBe('dark');
  });

  it('Auto follows the sun across the spring change, where 7:00 on the wall moves an hour in UTC', () => {
    // Sunrise 07:26 and sunset 19:10 on the 8th, both on daylight time (UTC-5).
    expect(mode('2026-03-08T12:25:59.999', 'auto', SPRING)).toBe('dark');
    expect(mode('2026-03-08T12:26:00', 'auto', SPRING)).toBe('light');
    expect(mode('2026-03-09T00:09:59.999', 'auto', SPRING)).toBe('light');
    expect(mode('2026-03-09T00:10:00', 'auto', SPRING)).toBe('dark');
    // The day before is on standard time (UTC-6): sunrise 06:27 is 12:27 UTC.
    expect(mode('2026-03-07T12:26:59.999', 'auto', SPRING)).toBe('dark');
    expect(mode('2026-03-07T12:27:00', 'auto', SPRING)).toBe('light');
    for (const iso of ['2026-03-08T05:00:00', '2026-03-08T18:00:00']) {
      expect(mode(iso, 'light', SPRING), iso).toBe('light');
      expect(mode(iso, 'dark', SPRING), iso).toBe('dark');
    }
  });

  it('Auto goes light at 6:46 AM Chicago time on the day the clocks go back, not an hour later', () => {
    // On the Household date 2025-11-02 the sunrise is 12:46 UTC, 6:46 AM on standard time, and the sunset is 23:43 UTC, 5:43 PM.
    // The forecast's text for that sunrise said 07:46: read as 7:46 AM Chicago time it would be 13:46 UTC, an hour late.
    expect(mode('2025-11-02T12:45:59.999', 'auto', FALL)).toBe('dark');
    expect(mode('2025-11-02T12:46:00', 'auto', FALL)).toBe('light');
    expect(mode('2025-11-02T13:30:00', 'auto', FALL)).toBe('light');
    expect(mode('2025-11-02T23:42:59.999', 'auto', FALL)).toBe('light');
    expect(mode('2025-11-02T23:43:00', 'auto', FALL)).toBe('dark');
    // The day before is still on daylight time: its sunrise is 12:45 UTC, 7:45 AM.
    expect(mode('2025-11-01T12:44:59.999', 'auto', FALL)).toBe('dark');
    expect(mode('2025-11-01T12:45:00', 'auto', FALL)).toBe('light');
    // The hour from 01:00 to 02:00 happens twice that night, at 06:30 UTC and again at 07:30 UTC: dark both times, and Light
    // and Dark hold through it.
    for (const iso of ['2025-11-02T06:30:00', '2025-11-02T07:30:00']) {
      expect(mode(iso, 'auto', FALL), iso).toBe('dark');
      expect(mode(iso, 'light', FALL), iso).toBe('light');
      expect(mode(iso, 'dark', FALL), iso).toBe('dark');
    }
  });

  it("the screen's switch still wins over each Appearance with the forecast, until it ends", () => {
    const now = at('2026-10-01T15:00:00');
    const until = at('2026-10-01T23:48:00');
    for (const appearance of ['auto', 'light', 'dark'] as const) {
      expect(resolveMode({ now, timezone: CHICAGO, appearance, ...sunAt(OCTOBER, CHICAGO, now), override: { mode: 'dark', until } }), appearance).toBe('dark');
    }
    // At the sunset the override ends and Auto is dark by itself; Light is light again.
    expect(resolveMode({ now: until, timezone: CHICAGO, appearance: 'light', ...sunAt(OCTOBER, CHICAGO, until), override: { mode: 'dark', until } })).toBe('light');
  });
});

describe('resolveMode: the screen\'s override', () => {
  const noon = at('2026-10-01T18:00:00');
  const until = at('2026-10-02T00:00:00');

  it('wins until the instant it ends, over Auto, Light and Dark alike', () => {
    for (const appearance of ['auto', 'light', 'dark'] as const) {
      expect(resolveMode({ now: noon, timezone: CHICAGO, appearance, override: { mode: 'dark', until } })).toBe('dark');
      expect(resolveMode({ now: until - 1, timezone: CHICAGO, appearance, override: { mode: 'dark', until } })).toBe('dark');
    }
  });

  it('is gone at the instant it ends and after it, and the Appearance and the clock take over again', () => {
    expect(resolveMode({ now: until, timezone: CHICAGO, override: { mode: 'light', until } })).toBe('dark');
    expect(resolveMode({ now: until + 60_000, timezone: CHICAGO, override: { mode: 'light', until } })).toBe('dark');
    expect(resolveMode({ now: until, timezone: CHICAGO, appearance: 'light', override: { mode: 'dark', until } })).toBe('light');
    expect(resolveMode({ now: noon, timezone: CHICAGO, override: null })).toBe('light');
  });
});

describe('resolveMode: before the Household is known', () => {
  it('keeps the mode the screen last resolved, light when it has none', () => {
    expect(resolveMode({ now: at('2026-10-01T18:00:00'), timezone: null })).toBe('light');
    expect(resolveMode({ now: at('2026-10-01T18:00:00'), timezone: null, last: 'dark' })).toBe('dark');
    expect(resolveMode({ now: at('2026-10-01T04:00:00'), timezone: null, last: 'light' })).toBe('light');
  });

  it('is not moved by the Appearance, the override or the sun until the Household is read', () => {
    const until = at('2026-10-02T00:00:00');
    expect(resolveMode({ now: at('2026-10-01T18:00:00'), timezone: null, last: 'dark', appearance: 'light', override: { mode: 'light', until } })).toBe('dark');
  });
});

// The first read of the forecast has not finished or failed, so the sun is not known. Only Auto with no override in force
// needs the sun, so only that waits for it: an override that has not ended and Light or Dark say what the mode is at once.
describe('resolveMode: before the sun is known', () => {
  const waiting = { timezone: CHICAGO, sunKnown: false };
  const noon = at('2026-10-01T18:00:00'); // 13:00 in Chicago, where Auto says light
  const night = at('2026-10-01T06:00:00'); // 01:00, where Auto says dark
  const until = at('2026-10-02T00:00:00'); // 19:00

  it('keeps the mode the screen last resolved for Auto, light when it has none', () => {
    expect(resolveMode({ now: noon, ...waiting, last: 'dark' })).toBe('dark');
    expect(resolveMode({ now: night, ...waiting, last: 'light' })).toBe('light');
    expect(resolveMode({ now: noon, ...waiting, appearance: 'auto', last: 'dark' })).toBe('dark');
    expect(resolveMode({ now: noon, ...waiting })).toBe('light');
    expect(resolveMode({ now: night, ...waiting })).toBe('light');
  });

  it('resolves Auto as soon as the sun is known, and a sun left out is known', () => {
    expect(resolveMode({ now: noon, timezone: CHICAGO, sunKnown: true, last: 'dark' })).toBe('light');
    expect(resolveMode({ now: night, timezone: CHICAGO, sunKnown: true, last: 'light' })).toBe('dark');
    expect(resolveMode({ now: noon, timezone: CHICAGO, last: 'dark' })).toBe('light');
  });

  it('does not make Light or Dark wait', () => {
    for (const now of [noon, night]) {
      expect(resolveMode({ now, ...waiting, appearance: 'light', last: 'dark' })).toBe('light');
      expect(resolveMode({ now, ...waiting, appearance: 'dark', last: 'light' })).toBe('dark');
    }
  });

  it('does not make an override that has not ended wait, whatever the Appearance', () => {
    for (const appearance of ['auto', 'light', 'dark'] as const) {
      expect(resolveMode({ now: noon, ...waiting, appearance, override: { mode: 'dark', until }, last: 'light' }), appearance).toBe('dark');
      expect(resolveMode({ now: noon, ...waiting, appearance, override: { mode: 'light', until }, last: 'dark' }), appearance).toBe('light');
      expect(resolveMode({ now: until - 1, ...waiting, appearance, override: { mode: 'dark', until }, last: 'light' }), appearance).toBe('dark');
    }
  });

  it('has Auto wait again once the override has ended, and Light and Dark carry on', () => {
    expect(resolveMode({ now: until, ...waiting, override: { mode: 'light', until }, last: 'dark' })).toBe('dark');
    expect(resolveMode({ now: until + 60_000, ...waiting, override: { mode: 'dark', until }, last: 'light' })).toBe('light');
    expect(resolveMode({ now: until, ...waiting, appearance: 'light', override: { mode: 'dark', until }, last: 'dark' })).toBe('light');
  });

  // The screen's switch goes on what the screen has at that moment: with no days the forecast says nothing of the sun, so it is
  // 7:00 and 19:00 in the Household Timezone, and an override set then ends at the next of them.
  it('has an override set while the sun is unknown end at the next 7:00 or 19:00 Household time', () => {
    const ends = (iso: string) => nextBoundary({ now: at(iso), timezone: CHICAGO, ...sunAt([], CHICAGO, at(iso)) });
    expect(ends('2026-10-01T06:00:00')).toBe(at('2026-10-01T12:00:00'));
    expect(ends('2026-10-01T18:00:00')).toBe(at('2026-10-02T00:00:00'));
    expect(ends('2026-10-02T01:00:00')).toBe(at('2026-10-02T12:00:00'));
    // Across a daylight saving change the 7:00 after Saturday evening is 12:00 UTC on the Sunday it goes forward.
    expect(ends('2026-03-08T02:00:00')).toBe(at('2026-03-08T12:00:00'));
  });

  it('shows that override at once, until then, and has Auto wait again after it', () => {
    // Tapped at 13:00 while the screen shows dark: light until 19:00, then Auto waits for the sun and keeps what it has.
    const ends = nextBoundary({ now: noon, timezone: CHICAGO, ...sunAt([], CHICAGO, noon) });
    expect(ends).toBe(until);
    expect(resolveMode({ now: noon, ...waiting, override: { mode: 'light', until: ends }, last: 'dark' })).toBe('light');
    expect(resolveMode({ now: ends - 1, ...waiting, override: { mode: 'light', until: ends }, last: 'light' })).toBe('light');
    expect(resolveMode({ now: ends, ...waiting, override: { mode: 'light', until: ends }, last: 'light' })).toBe('light');
    expect(resolveMode({ now: ends, ...waiting, override: { mode: 'light', until: ends }, last: 'dark' })).toBe('dark');
  });

  it('is held back by nothing but the Household: with it not read the screen keeps its mode whatever else is given', () => {
    for (const sunKnown of [true, false]) {
      for (const appearance of ['auto', 'light', 'dark'] as const) {
        const label = `${appearance}, sun ${sunKnown ? 'known' : 'unknown'}`;
        expect(resolveMode({ now: noon, timezone: null, sunKnown, appearance, override: { mode: 'light', until }, last: 'dark' }), label).toBe('dark');
        expect(resolveMode({ now: noon, timezone: null, sunKnown, appearance, override: { mode: 'dark', until }, last: 'light' }), label).toBe('light');
        expect(resolveMode({ now: night, timezone: null, sunKnown, appearance, last: 'dark' }), label).toBe('dark');
        expect(resolveMode({ now: noon, timezone: null, sunKnown, appearance }), label).toBe('light');
      }
    }
  });
});

describe('nextBoundary: when the switch\'s override ends', () => {
  const boundary = (iso: string, more = {}) => nextBoundary({ now: at(iso), timezone: CHICAGO, ...more });

  it('is the next sunrise or sunset, 7:00 or 19:00 without them', () => {
    expect(boundary('2026-10-01T09:00:00')).toBe(at('2026-10-01T12:00:00'));
    expect(boundary('2026-10-01T12:00:00')).toBe(at('2026-10-02T00:00:00'));
    expect(boundary('2026-10-01T18:00:00')).toBe(at('2026-10-02T00:00:00'));
    expect(boundary('2026-10-02T00:00:00')).toBe(at('2026-10-02T12:00:00'));
    expect(boundary('2026-10-02T03:00:00')).toBe(at('2026-10-02T12:00:00'));
  });

  it("is the Household's 7:00 the next morning when it is after sunset, across a daylight saving change", () => {
    // Saturday 2026-03-07 at 20:00 in Chicago is 02:00 UTC: the next 7:00 is on daylight time, ten hours on.
    expect(boundary('2026-03-08T02:00:00')).toBe(at('2026-03-08T12:00:00'));
    // Saturday 2026-10-31 at 20:00 is 01:00 UTC on the 1st: the next 7:00 is on standard time, twelve hours on.
    expect(boundary('2026-11-01T01:00:00')).toBe(at('2026-11-01T13:00:00'));
  });

  it("is the sun's own instants when it has them, and the day's sunrise when it comes next", () => {
    const sun = { sunrise: at('2026-10-01T11:12:00'), sunset: at('2026-10-02T00:48:00') };
    expect(boundary('2026-10-01T10:00:00', sun)).toBe(sun.sunrise);
    expect(boundary('2026-10-01T15:00:00', sun)).toBe(sun.sunset);
    const nextSunrise = at('2026-10-02T11:13:00');
    expect(boundary('2026-10-02T01:00:00', { ...sun, nextSunrise })).toBe(nextSunrise);
  });

  it("is the forecast's own sunrise and sunset, and the next sunrise after the sunset, as sunAt reads them", () => {
    const next = (iso: string, days: SunDay[]) => boundary(iso, sunAt(days, CHICAGO, at(iso)));
    expect(next('2026-10-01T10:00:00', OCTOBER)).toBe(at('2026-10-01T12:12:00'));
    expect(next('2026-10-01T15:00:00', OCTOBER)).toBe(at('2026-10-01T23:48:00'));
    // After the sunset it is the next morning's sunrise from the forecast, not 7:00.
    expect(next('2026-10-02T01:00:00', OCTOBER)).toBe(at('2026-10-02T12:13:00'));
    // The forecast's last day has no next morning to go on: 7:00.
    expect(next('2026-10-04T01:00:00', OCTOBER)).toBe(at('2026-10-04T12:00:00'));
  });

  it("is the next sunrise on the other side of a daylight saving change, from the forecast's instants", () => {
    const next = (iso: string, days: SunDay[]) => boundary(iso, sunAt(days, CHICAGO, at(iso)));
    // Saturday 2026-03-07 at 20:00 in Chicago, after the 18:09 sunset: Sunday's sunrise is 12:26 UTC.
    expect(next('2026-03-08T02:00:00', SPRING)).toBe(at('2026-03-08T12:26:00'));
    // Saturday 2025-11-01 at 20:00 (01:00 UTC on the 2nd), after the 6:44 PM sunset: Sunday's is 6:46 AM on standard time, 12:46 UTC.
    expect(next('2025-11-02T01:00:00', FALL)).toBe(1762087560000);
    // Sunday at 19:00 on standard time (01:00 UTC on the 3rd), after its 5:43 PM sunset: Monday's, 12:46 UTC.
    expect(next('2025-11-03T01:00:00', FALL)).toBe(at('2025-11-03T12:46:00'));
  });

  it('is never before now', () => {
    for (const iso of ['2026-10-01T11:59:59.999', '2026-10-01T12:00:00', '2026-10-01T23:59:59.999', '2026-10-02T00:00:00']) {
      expect(boundary(iso)).toBeGreaterThan(at(iso));
    }
  });
});

// ---- What the screen keeps in localStorage ----------------------------------------------------

function fakeStore(initial: Record<string, string> = {}): ModeStore & { items: Map<string, string> } {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

// A store the browser will not let a page use (blocked site data): every use throws.
const blocked: ModeStore = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('SecurityError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

describe('the mode a screen last resolved', () => {
  it('is light when nothing is stored, when what is stored is not a mode, and when there is no storage', () => {
    expect(readLastMode(fakeStore())).toBe('light');
    expect(readLastMode(fakeStore({ [MODE_KEY]: 'purple' }))).toBe('light');
    expect(readLastMode(null)).toBe('light');
    expect(readLastMode(blocked)).toBe('light');
  });

  it('comes back as it was kept', () => {
    const store = fakeStore();
    writeLastMode(store, 'dark');
    expect(readLastMode(store)).toBe('dark');
    writeLastMode(store, 'light');
    expect(readLastMode(store)).toBe('light');
  });

  it('is kept quietly when there is nowhere to keep it', () => {
    expect(() => writeLastMode(blocked, 'dark')).not.toThrow();
    expect(() => writeLastMode(null, 'dark')).not.toThrow();
  });
});

describe('the override a screen keeps', () => {
  const now = at('2026-10-01T18:00:00');
  const until = at('2026-10-02T00:00:00');

  it('comes back with the instant it ends, until that instant', () => {
    const store = fakeStore();
    writeOverride(store, { mode: 'dark', until });
    expect(readOverride(store, now)).toEqual({ mode: 'dark', until });
    expect(readOverride(store, until - 1)).toEqual({ mode: 'dark', until });
    expect(readOverride(store, until)).toBeNull();
    expect(readOverride(store, until + 1)).toBeNull();
  });

  // The switch sets one that ends at the next sunrise or sunset, which is never more than a day away. One that ends later than
  // that was written by a wrong clock or by hand, and would hold a mode for days.
  it('is none when it ends more than 24 hours from now, a wrong clock cannot hold a mode for days', () => {
    const store = fakeStore();
    expect(MAX_OVERRIDE_MS).toBe(24 * 60 * 60 * 1000);
    writeOverride(store, { mode: 'dark', until: now + MAX_OVERRIDE_MS });
    expect(readOverride(store, now)).toEqual({ mode: 'dark', until: now + MAX_OVERRIDE_MS });
    writeOverride(store, { mode: 'dark', until: now + MAX_OVERRIDE_MS + 1 });
    expect(readOverride(store, now)).toBeNull();
    writeOverride(store, { mode: 'dark', until: now + 365 * 24 * 60 * 60 * 1000 });
    expect(readOverride(store, now)).toBeNull();
    // The same override, read once the clock has moved on far enough, is within the day and counts.
    expect(readOverride(store, now + 364 * 24 * 60 * 60 * 1000)).not.toBeNull();
  });

  it('is cleared when it is written as none', () => {
    const store = fakeStore();
    writeOverride(store, { mode: 'dark', until });
    writeOverride(store, null);
    expect(store.items.has(OVERRIDE_KEY)).toBe(false);
    expect(readOverride(store, now)).toBeNull();
  });

  it('is none when what is stored is not an override', () => {
    for (const stored of ['', 'not json', '{}', '{"mode":"purple","until":9999999999999}', '{"mode":"dark"}', '{"mode":"dark","until":"later"}', 'null', '[]']) {
      expect(readOverride(fakeStore({ [OVERRIDE_KEY]: stored }), now), stored).toBeNull();
    }
    expect(readOverride(fakeStore(), now)).toBeNull();
  });

  it('is none, and keeps quiet, when there is no storage', () => {
    expect(readOverride(null, now)).toBeNull();
    expect(readOverride(blocked, now)).toBeNull();
    expect(() => writeOverride(blocked, { mode: 'dark', until })).not.toThrow();
    expect(() => writeOverride(null, null)).not.toThrow();
  });

  it('stays on this screen: it is written to storage and to nothing else', () => {
    const store = fakeStore();
    writeOverride(store, { mode: 'light', until });
    expect([...store.items.keys()]).toEqual([OVERRIDE_KEY]);
  });
});

// ---- The script in index.html, which paints the mode before React does ---------------------------

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];

// Runs the page's inline script in a page that has what is given, and says what it set data-mode to (undefined when it set
// nothing, which leaves the page light), what it put in the color-scheme and theme-color metas, whether it threw, and which
// globals it left behind.
function paint({
  path,
  stored,
  prefersDark = false,
  storage = 'works',
  metas = 'present',
}: {
  path: string;
  stored?: string;
  prefersDark?: boolean;
  storage?: 'works' | 'blocked';
  metas?: 'present' | 'missing';
}) {
  const page: { mode?: string; metas: Record<string, string> } = { metas: {} };
  const sandbox: Record<string, unknown> = {
    location: { pathname: path },
    matchMedia: (query: string) => ({ matches: query === '(prefers-color-scheme: dark)' && prefersDark }),
    document: {
      documentElement: { setAttribute: (name: string, value: string) => void (name === 'data-mode' && (page.mode = value)) },
      querySelector: (selector: string) => {
        const meta = /name=["']?([\w-]+)/.exec(selector)?.[1];
        if (metas === 'missing' || meta === undefined) return null;
        return { setAttribute: (name: string, value: string) => void (name === 'content' && (page.metas[meta] = value)) };
      },
    },
  };
  if (storage === 'blocked') {
    Object.defineProperty(sandbox, 'localStorage', {
      get() {
        throw new Error('SecurityError');
      },
    });
  } else {
    sandbox.localStorage = fakeStore(stored === undefined ? {} : { [MODE_KEY]: stored });
  }
  const before = new Set(Object.keys(sandbox));
  let threw = false;
  try {
    runInNewContext(script!, sandbox);
  } catch {
    threw = true;
  }
  return { mode: page.mode, metas: page.metas, threw, leaked: Object.keys(sandbox).filter((key) => !before.has(key)) };
}

describe('the inline script in index.html', () => {
  it('is there, and the page starts light: no dark class, and the light page colour in its metas', () => {
    expect(script).toBeTruthy();
    expect(html).not.toMatch(/<html[^>]*class=/);
    expect(html).toContain(`<meta name="theme-color" content="${TOKENS.light.background}" />`);
    expect(html).toContain('<meta name="color-scheme" content="light" />');
  });

  it('paints the mode the Wall last resolved, light when it has none', () => {
    expect(paint({ path: '/', stored: 'dark' })).toMatchObject({ mode: 'dark', threw: false });
    expect(paint({ path: '/week', stored: 'light' })).toMatchObject({ mode: 'light', threw: false });
    expect(paint({ path: '/routines' })).toMatchObject({ mode: 'light', threw: false });
    expect(paint({ path: '/meals', stored: 'purple' })).toMatchObject({ mode: 'light', threw: false });
  });

  // So a dark reload does not show a light browser bar until React mounts and applyMode() catches up.
  it('sets the color-scheme and theme-color metas with the mode, the Wall and the phone alike', () => {
    expect(paint({ path: '/', stored: 'dark' }).metas).toEqual({ 'color-scheme': 'dark', 'theme-color': TOKENS.dark.background });
    expect(paint({ path: '/', stored: 'light' }).metas).toEqual({ 'color-scheme': 'light', 'theme-color': TOKENS.light.background });
    expect(paint({ path: '/settings', prefersDark: true }).metas).toEqual({ 'color-scheme': 'dark', 'theme-color': TOKENS.dark.background });
    expect(paint({ path: '/settings', prefersDark: false, stored: 'dark' }).metas).toEqual({ 'color-scheme': 'light', 'theme-color': TOKENS.light.background });
  });

  it('sets data-mode even when a meta element is missing', () => {
    expect(paint({ path: '/', stored: 'dark', metas: 'missing' })).toMatchObject({ mode: 'dark', threw: false, metas: {} });
  });

  it('keeps its variables to itself: it leaves no globals behind, whichever way it ends', () => {
    for (const options of [{ path: '/', stored: 'dark' }, { path: '/settings', prefersDark: true }, { path: '/', storage: 'blocked' as const }]) {
      expect(paint(options).leaked, JSON.stringify(options)).toEqual([]);
    }
  });

  it("paints the phone's pages from prefers-color-scheme, never from what the Wall stored", () => {
    for (const path of ['/settings', '/settings/', '/settings/routines', '/settings/events']) {
      expect(paint({ path, stored: 'light', prefersDark: true }).mode, path).toBe('dark');
      expect(paint({ path, stored: 'dark', prefersDark: false }).mode, path).toBe('light');
      expect(paint({ path, prefersDark: false }).mode, path).toBe('light');
    }
  });

  it("takes a path that only starts with the word settings for the Wall's", () => {
    expect(paint({ path: '/settingsx', stored: 'dark', prefersDark: false }).mode).toBe('dark');
  });

  it('leaves the page light, without throwing, when the browser will not give it localStorage', () => {
    expect(paint({ path: '/', storage: 'blocked' })).toMatchObject({ mode: undefined, threw: false, metas: {} });
  });

  it('still follows the phone when localStorage is blocked, since it never needed it there', () => {
    expect(paint({ path: '/settings', storage: 'blocked', prefersDark: true }).mode).toBe('dark');
  });
});
