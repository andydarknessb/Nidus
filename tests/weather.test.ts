import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  CURRENT_MAX_AGE_MS,
  PLACE_MAX_LENGTH,
  capPlace,
  describePlaces,
  describeWeather,
  forecastDay,
  forecastToShow,
  forecastUrl,
  geocodingUrl,
  parseForecast,
  parsePlaces,
  readDelayMs,
  requestInit,
  type WeatherIcon,
} from '../src/lib/weather';

// Open-Meteo's real answers, recorded once (tests/fixtures) and read here as data. Nothing in this
// file calls or fakes the network.
function recorded(name: string) {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
}

describe('forecastUrl', () => {
  it('asks for the current reading and a week of daily highs, lows and codes, with no key', () => {
    const url = new URL(forecastUrl(30.27, -97.74, 'fahrenheit', 'America/Chicago'));

    expect(`${url.origin}${url.pathname}`).toBe('https://api.open-meteo.com/v1/forecast');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      latitude: '30.27',
      longitude: '-97.74',
      current: 'temperature_2m,weather_code,is_day',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min',
      temperature_unit: 'fahrenheit',
      timezone: 'America/Chicago',
      forecast_days: '7',
    });
  });

  it('writes the Household Timezone URL-encoded, so the daily dates are Household dates', () => {
    expect(forecastUrl(30.27, -97.74, 'fahrenheit', 'America/Chicago')).toContain('timezone=America%2FChicago');

    const deep = new URL(forecastUrl(-34.6, -58.38, 'celsius', 'America/Argentina/Buenos_Aires'));
    expect(deep.search).toContain('timezone=America%2FArgentina%2FBuenos_Aires');
    expect(deep.searchParams.get('timezone')).toBe('America/Argentina/Buenos_Aires');
  });

  it('carries the temperature unit and keeps a negative coordinate whole', () => {
    const url = new URL(forecastUrl(48.85, -2.35, 'celsius', 'Europe/Paris'));

    expect(url.searchParams.get('temperature_unit')).toBe('celsius');
    expect(url.searchParams.get('longitude')).toBe('-2.35');
  });
});

describe('parseForecast', () => {
  it('reads the recorded answer: the reading now and seven days in order', () => {
    const forecast = parseForecast(recorded('open-meteo-forecast'));

    expect(forecast.current).toEqual({ temperature: 76, code: 80, isDay: true });
    expect(forecast.days).toHaveLength(7);
    expect(forecast.days.map((day) => day.date)).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
    ]);
    expect(forecast.days[0]).toEqual({ date: '2026-10-01', high: 84, low: 75, code: 82 });
    expect(forecast.days[6]).toEqual({ date: '2026-10-07', high: 90, low: 74, code: 0 });
  });

  it('gives whole degrees only', () => {
    const forecast = parseForecast(recorded('open-meteo-forecast'));

    expect(Number.isInteger(forecast.current?.temperature)).toBe(true);
    for (const day of forecast.days) {
      expect(Number.isInteger(day.high), day.date).toBe(true);
      expect(Number.isInteger(day.low), day.date).toBe(true);
    }
  });

  it('rounds to the nearest degree, below zero too', () => {
    const body = recorded('open-meteo-forecast');
    body.current.temperature_2m = -3.6;
    body.daily.temperature_2m_max[0] = 2.5;
    body.daily.temperature_2m_min[0] = -3.4;

    const forecast = parseForecast(body);

    expect(forecast.current?.temperature).toBe(-4);
    expect(forecast.days[0]).toMatchObject({ high: 3, low: -3 });
  });

  it('reads is_day 0 as night', () => {
    const body = recorded('open-meteo-forecast');
    body.current.is_day = 0;

    expect(parseForecast(body).current?.isDay).toBe(false);
  });

  // A bad answer must be a failed read, never a wrong number on the Wall.
  const good = recorded('open-meteo-forecast');
  const withCurrent = (current: object) => ({ ...good, current: { ...good.current, ...current } });
  const withDaily = (daily: object) => ({ ...good, daily: { ...good.daily, ...daily } });
  const rest = <T>(list: T[]) => list.slice(1);
  const broken: [string, unknown][] = [
    ['nothing at all', null],
    ['text instead of an object', 'Service Unavailable'],
    ['a list instead of an object', []],
    ['Open-Meteo\'s own error body', { error: true, reason: 'Invalid timezone' }],
    ['no current reading', { ...good, current: undefined }],
    ['no daily lists', { ...good, daily: undefined }],
    ['no dates', withDaily({ time: undefined })],
    ['no weather codes', withDaily({ weather_code: undefined })],
    ['no highs', withDaily({ temperature_2m_max: undefined })],
    ['no lows', withDaily({ temperature_2m_min: undefined })],
    ['a list that is not a list', withDaily({ temperature_2m_max: 84 })],
    ['one high fewer than dates', withDaily({ temperature_2m_max: rest(good.daily.temperature_2m_max) })],
    ['one low fewer than dates', withDaily({ temperature_2m_min: rest(good.daily.temperature_2m_min) })],
    ['one code fewer than dates', withDaily({ weather_code: rest(good.daily.weather_code) })],
    ['one date fewer than highs', withDaily({ time: rest(good.daily.time) })],
    ['a high that is text', withDaily({ temperature_2m_max: ['84', ...rest(good.daily.temperature_2m_max)] })],
    ['a low that is missing', withDaily({ temperature_2m_min: [null, ...rest(good.daily.temperature_2m_min)] })],
    ['a code that is text', withDaily({ weather_code: ['82', ...rest(good.daily.weather_code)] })],
    ['a date that is not a date', withDaily({ time: ['soon', ...rest(good.daily.time)] })],
    ['a date that is a number', withDaily({ time: [20261001, ...rest(good.daily.time)] })],
    ['no days at all', withDaily({ time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [] })],
    ['a temperature now that is text', withCurrent({ temperature_2m: '75.9' })],
    ['no temperature now', withCurrent({ temperature_2m: undefined })],
    ['a code now that is missing', withCurrent({ weather_code: null })],
    ['no is_day', withCurrent({ is_day: undefined })],
  ];

  // The refusal is the parser's own, not an accident of reading something that is not there.
  it.each(broken)('throws on %s', (_name, body) => {
    expect(() => parseForecast(body)).toThrow('Open-Meteo');
  });
});

describe('describeWeather', () => {
  const groups: [string, WeatherIcon, number[]][] = [
    ['Cloudy', 'cloud', [3]],
    ['Fog', 'fog', [45, 48]],
    ['Drizzle', 'drizzle', [51, 53, 55]],
    ['Freezing drizzle', 'drizzle', [56, 57]],
    ['Rain', 'rain', [61, 63, 65, 80, 81, 82]],
    ['Freezing rain', 'rain', [66, 67]],
    ['Snow', 'snow', [71, 73, 75, 77, 85, 86]],
    ['Thunderstorm', 'thunderstorm', [95, 96, 99]],
  ];

  it.each(groups)('says %s and shows its icon for every code in the group, day or night', (words, icon, codes) => {
    for (const code of codes) {
      expect(describeWeather(code, true), `code ${code} by day`).toEqual({ words, icon });
      expect(describeWeather(code, false), `code ${code} by night`).toEqual({ words, icon });
    }
  });

  it('shows a clear sky as the sun by day and the moon by night', () => {
    expect(describeWeather(0, true)).toEqual({ words: 'Clear', icon: 'sun' });
    expect(describeWeather(0, false)).toEqual({ words: 'Clear', icon: 'moon' });
  });

  it('shows mostly clear and partly cloudy as a cloud with the sun by day and with the moon by night', () => {
    expect(describeWeather(1, true)).toEqual({ words: 'Mostly clear', icon: 'cloud-sun' });
    expect(describeWeather(1, false)).toEqual({ words: 'Mostly clear', icon: 'cloud-moon' });
    expect(describeWeather(2, true)).toEqual({ words: 'Partly cloudy', icon: 'cloud-sun' });
    expect(describeWeather(2, false)).toEqual({ words: 'Partly cloudy', icon: 'cloud-moon' });
  });

  it('takes it to be day when it is not told', () => {
    expect(describeWeather(0)).toEqual(describeWeather(0, true));
    expect(describeWeather(2)).toEqual(describeWeather(2, true));
  });

  it('knows every code Open-Meteo documents', () => {
    const documented = [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99];
    for (const code of documented) expect(describeWeather(code).words, `code ${code}`).not.toBe('Unknown');
  });

  it('says Unknown, with the plain cloud, for a code it does not know', () => {
    for (const code of [-1, 4, 44, 100, 1.5, Number.NaN]) {
      expect(describeWeather(code), `code ${code}`).toEqual({ words: 'Unknown', icon: 'cloud' });
    }
  });
});

describe('requestInit', () => {
  it('sends no cookies and no referrer, and gives the request a time limit', () => {
    const init = requestInit();

    expect(init.credentials).toBe('omit');
    expect(init.referrerPolicy).toBe('no-referrer');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal?.aborted).toBe(false);
  });

  it('makes the limit thirty seconds, started afresh for each request', () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    try {
      const first = requestInit();
      const second = requestInit();

      expect(timeout).toHaveBeenCalledTimes(2);
      expect(timeout).toHaveBeenCalledWith(30_000);
      expect(first.signal).not.toBe(second.signal);
    } finally {
      timeout.mockRestore();
    }
  });

  // AbortSignal.timeout is newer than some WebViews. A Wall that loses its weather entirely for want of
  // it is worse than one that waits, so without it the request goes out with no limit.
  it('still sends the question, with no limit, where the browser has no AbortSignal.timeout', () => {
    const timeout = AbortSignal.timeout;
    Object.defineProperty(AbortSignal, 'timeout', { value: undefined, configurable: true, writable: true });
    try {
      const init = requestInit();

      expect('signal' in init).toBe(false);
      expect(init).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' });
    } finally {
      Object.defineProperty(AbortSignal, 'timeout', { value: timeout, configurable: true, writable: true });
    }
  });
});

describe('geocodingUrl', () => {
  it('asks for up to five matches, in English, as JSON', () => {
    const url = new URL(geocodingUrl('Austin'));

    expect(`${url.origin}${url.pathname}`).toBe('https://geocoding-api.open-meteo.com/v1/search');
    expect(Object.fromEntries(url.searchParams)).toEqual({ name: 'Austin', count: '5', language: 'en', format: 'json' });
  });

  it('keeps whatever was typed inside the name parameter', () => {
    const url = new URL(geocodingUrl('São José & #1'));

    expect(url.searchParams.get('name')).toBe('São José & #1');
    expect([...url.searchParams.keys()].sort()).toEqual(['count', 'format', 'language', 'name']);
  });
});

describe('parsePlaces', () => {
  // The coordinates come through as sent: the database rounds them to two decimals when they are saved.
  it('reads the recorded answer: five matches', () => {
    const places = parsePlaces(recorded('open-meteo-places'));

    expect(places).toHaveLength(5);
    expect(places[0]).toEqual({ name: 'Austin', region: 'Texas', subregion: 'Travis', country: 'United States', latitude: 30.26715, longitude: -97.74306 });
    expect(places[4]).toEqual({ name: 'Ardmore', region: 'Tennessee', subregion: 'Giles', country: 'United States', latitude: 34.99203, longitude: -86.84667 });
  });

  it('keeps the county or district Open-Meteo calls admin2', () => {
    const places = parsePlaces(recorded('open-meteo-places-same-name'));

    expect(places.map((place) => place.subregion)).toEqual(['Oświęcim County', 'Myślenice County', 'Koło County', null]);
  });

  it('is an empty list when Open-Meteo found nothing, which it says by sending no results at all', () => {
    expect(parsePlaces({ generationtime_ms: 0.2793 })).toEqual([]);
  });

  it('leaves out a region, county or country Open-Meteo did not send', () => {
    const places = parsePlaces({ results: [{ name: 'Reykjavik', country: 'Iceland', latitude: 64.14, longitude: -21.9 }, { name: 'Atlantis', latitude: 0, longitude: 0 }] });

    expect(places).toEqual([
      { name: 'Reykjavik', region: null, subregion: null, country: 'Iceland', latitude: 64.14, longitude: -21.9 },
      { name: 'Atlantis', region: null, subregion: null, country: null, latitude: 0, longitude: 0 },
    ]);
  });

  const place = { name: 'Austin', admin1: 'Texas', country: 'United States', latitude: 30.26715, longitude: -97.74306 };
  const broken: [string, unknown][] = [
    ['nothing at all', null],
    ['text instead of an object', 'Service Unavailable'],
    ['results that are not a list', { results: 'Austin' }],
    ['results that are null', { results: null }],
    ['a match that is not an object', { results: ['Austin'] }],
    ['a match with no name', { results: [{ ...place, name: undefined }] }],
    ['a match with an empty name', { results: [{ ...place, name: '' }] }],
    ['a match with no latitude', { results: [{ ...place, latitude: undefined }] }],
    ['a match with a longitude that is text', { results: [{ ...place, longitude: '-97.74' }] }],
  ];

  it.each(broken)('throws on %s', (_name, body) => {
    expect(() => parsePlaces(body)).toThrow('Open-Meteo');
  });
});

describe('describePlaces', () => {
  const words = (answer: unknown) => describePlaces(parsePlaces(answer)).map((option) => option.place);
  const twin = { name: 'Springfield', region: 'Illinois', country: 'United States' };

  it('words a place by its name, region and country, leaving out what Open-Meteo did not send', () => {
    expect(words(recorded('open-meteo-places'))).toEqual([
      'Austin, Texas, United States',
      'Austin, Minnesota, United States',
      'Austin, Indiana, United States',
      'Austin, Arkansas, United States',
      'Ardmore, Tennessee, United States',
    ]);
    expect(words({ results: [{ name: 'Reykjavik', country: 'Iceland', latitude: 64.14, longitude: -21.9 }, { name: 'Atlantis', latitude: 0, longitude: 0 }] })).toEqual(['Reykjavik, Iceland', 'Atlantis']);
  });

  // Hand-written, modelled on a live search for "Nowa Wieś": two places of that name in one region of one country.
  it('adds the county or district to the places that would otherwise read the same, and only to them', () => {
    const found = words(recorded('open-meteo-places-same-name'));

    expect(found).toEqual([
      'Nowa Wieś, Oświęcim County, Lesser Poland, Poland',
      'Nowa Wieś, Myślenice County, Lesser Poland, Poland',
      'Nowa Wieś Wielka, Greater Poland, Poland',
      'Nova-Ves’, Belarus',
    ]);
    expect(new Set(found).size).toBe(found.length);
  });

  it('tells apart two places when only one of them has a county', () => {
    const found = describePlaces([
      { ...twin, subregion: 'Sangamon County', latitude: 39.8, longitude: -89.64 },
      { ...twin, subregion: null, latitude: 38.2, longitude: -90.1 },
    ]).map((option) => option.place);

    expect(found).toEqual(['Springfield, Sangamon County, Illinois, United States', 'Springfield, Illinois, United States']);
  });

  it('says where they are when even the county is the same, or neither has one', () => {
    for (const subregion of ['Sangamon County', null]) {
      const found = describePlaces([
        { ...twin, subregion, latitude: 39.8, longitude: -89.64 },
        { ...twin, subregion, latitude: 38.2, longitude: -90.1 },
      ]).map((option) => option.place);

      const where = subregion === null ? 'Springfield, Illinois, United States' : 'Springfield, Sangamon County, Illinois, United States';
      expect(found, String(subregion)).toEqual([`${where} (39.80, -89.64)`, `${where} (38.20, -90.10)`]);
    }
  });

  it('hands each place back as a save takes it, with where it is as Open-Meteo sent it', () => {
    expect(describePlaces(parsePlaces(recorded('open-meteo-places')))[0]).toEqual({ place: 'Austin, Texas, United States', latitude: 30.26715, longitude: -97.74306 });
  });

  it('has nothing to say about no places', () => {
    expect(describePlaces([])).toEqual([]);
  });
});

describe('capPlace', () => {
  it('leaves a wording the column accepts as it was', () => {
    expect(PLACE_MAX_LENGTH).toBe(100);
    expect(capPlace('Austin, Texas, United States')).toBe('Austin, Texas, United States');
    expect(capPlace('x'.repeat(100))).toBe('x'.repeat(100));
  });

  it('cuts a longer one to the 100 characters the column holds', () => {
    expect(capPlace('x'.repeat(101))).toBe('x'.repeat(100));
    expect(capPlace('x'.repeat(5000))).toHaveLength(100);
  });

  it('counts characters the way the database does, so an emoji is one and is never cut in half', () => {
    expect(capPlace('👋'.repeat(100))).toBe('👋'.repeat(100));
    expect(capPlace('👋'.repeat(101))).toBe('👋'.repeat(100));
  });
});

describe('readDelayMs', () => {
  const minutes = (count: number) => count * 60_000;

  it('reads again half an hour after a good read', () => {
    expect(readDelayMs(0)).toBe(minutes(30));
  });

  it('waits a minute after the first failure', () => {
    expect(readDelayMs(1)).toBe(minutes(1));
  });

  it('doubles the wait with each failure in a row', () => {
    expect([1, 2, 3, 4, 5].map(readDelayMs)).toEqual([minutes(1), minutes(2), minutes(4), minutes(8), minutes(16)]);
  });

  it('never waits longer than the half hour, however many reads fail', () => {
    // The sixth failure in a row would be 32 minutes.
    for (const failures of [6, 7, 20, 1_000, 100_000]) expect(readDelayMs(failures), `${failures} failures`).toBe(minutes(30));
  });

  it('starts over once a read succeeds', () => {
    // The Wall counts the failures in a row and goes back to none on a good read.
    expect([3, 0, 1].map(readDelayMs)).toEqual([minutes(4), minutes(30), minutes(1)]);
  });
});

describe('forecastToShow', () => {
  const forecast = parseForecast(recorded('open-meteo-forecast'));
  const fetchedAt = Date.parse('2026-10-01T20:30:00Z');
  const minutes = (count: number) => count * 60_000;

  it('shows the whole forecast while the reading is fresh', () => {
    expect(forecastToShow(forecast, fetchedAt, fetchedAt)).toEqual(forecast);
    expect(forecastToShow(forecast, fetchedAt, fetchedAt + minutes(30))).toEqual(forecast);
  });

  it('still calls a reading of exactly two hours current', () => {
    expect(CURRENT_MAX_AGE_MS).toBe(minutes(120));
    expect(forecastToShow(forecast, fetchedAt, fetchedAt + CURRENT_MAX_AGE_MS)).toEqual(forecast);
  });

  it('drops the current conditions, and only them, once the reading is more than two hours old', () => {
    for (const age of [CURRENT_MAX_AGE_MS + 1, minutes(3 * 60), minutes(26 * 60)]) {
      const shown = forecastToShow(forecast, fetchedAt, fetchedAt + age);
      expect(shown.current, `after ${age} ms`).toBeNull();
      expect(shown.days, `after ${age} ms`).toEqual(forecast.days);
    }
  });

  it('drops the current conditions when the clock reads earlier than the reading', () => {
    // A clock that went back cannot say how old the reading is, so it cannot vouch for it.
    for (const back of [1, minutes(10), minutes(26 * 60)]) {
      const shown = forecastToShow(forecast, fetchedAt, fetchedAt - back);
      expect(shown.current, `${back} ms before the reading`).toBeNull();
      expect(shown.days, `${back} ms before the reading`).toEqual(forecast.days);
    }
  });

  it('does not change the forecast it was given', () => {
    const before = structuredClone(forecast);

    forecastToShow(forecast, fetchedAt, fetchedAt + minutes(300));

    expect(forecast).toEqual(before);
  });
});

describe('forecastDay', () => {
  const forecast = parseForecast(recorded('open-meteo-forecast'));

  it('finds the day for a Household date', () => {
    expect(forecastDay(forecast, '2026-10-03')).toEqual({ date: '2026-10-03', high: 79, low: 73, code: 63 });
    expect(forecastDay(forecast, '2026-10-01')).toBe(forecast.days[0]);
    expect(forecastDay(forecast, '2026-10-07')).toBe(forecast.days[6]);
  });

  it('finds nothing for a date the forecast does not cover', () => {
    expect(forecastDay(forecast, '2026-09-30')).toBeUndefined();
    expect(forecastDay(forecast, '2026-10-08')).toBeUndefined();
  });

  it('finds nothing when there is no forecast', () => {
    expect(forecastDay(null, '2026-10-01')).toBeUndefined();
  });
});
