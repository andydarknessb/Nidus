// Weather on the Wall (issue #58). The Household says where it lives; the Wall asks Open-Meteo (no
// key, no server hop) for that place's forecast and shows what comes back, storing nothing of it.
// Everything here is pure except the two thin fetchers at the bottom, so the request URLs, the
// parsers and the words are tested against recorded answers without touching the network.

export type TemperatureUnit = 'fahrenheit' | 'celsius';

// One day of the forecast. `date` is a Household date, because the request names the Household
// Timezone; `code` is a WMO weather code.
export type ForecastDay = { date: string; high: number; low: number; code: number };

// What the Wall shows: the reading now and each day's high and low, in whole degrees of the unit
// asked for. `current` is null once the reading is too old to call current (see forecastToShow).
export type Forecast = {
  current: { temperature: number; code: number; isDay: boolean } | null;
  days: ForecastDay[];
};

// A place found by name: Open-Meteo's name, region and country, which is what tells two Austins apart.
export type PlaceMatch = { name: string; region: string | null; country: string | null; latitude: number; longitude: number };

// The pictures a condition can have: a small closed set, drawn by components/Weather.tsx.
export type WeatherIcon = 'sun' | 'moon' | 'cloud-sun' | 'cloud-moon' | 'cloud' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'thunderstorm';

// ---- Requests -----------------------------------------------------------------------

// The reading now and a week of days, in the unit asked for. The Household Timezone makes the
// daily dates Household dates, so a day lines up with the wall's own day columns.
export function forecastUrl(latitude: number, longitude: number, unit: TemperatureUnit, timezone: string): string {
  const query = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,weather_code,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    temperature_unit: unit,
    timezone,
    forecast_days: '7',
  });
  return `https://api.open-meteo.com/v1/forecast?${query}`;
}

// Up to five places that match what was typed, in English.
export function geocodingUrl(name: string): string {
  const query = new URLSearchParams({ name, count: '5', language: 'en', format: 'json' });
  return `https://geocoding-api.open-meteo.com/v1/search?${query}`;
}

// ---- Answers ------------------------------------------------------------------------

// A bad answer is a failed read, never a wrong number on the Wall: each of these throws on
// anything it does not expect.
function objectOf(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Open-Meteo sent something that is not an object');
  return value as Record<string, unknown>;
}

function listOf(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Open-Meteo sent something that is not a list');
  return value;
}

function numberOf(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Open-Meteo sent something that is not a number');
  return value;
}

function textOf(value: unknown): string {
  if (typeof value !== 'string' || value === '') throw new Error('Open-Meteo sent something that is not text');
  return value;
}

function dateOf(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Open-Meteo sent something that is not a date');
  return value;
}

// Open-Meteo's forecast JSON as a Forecast, temperatures rounded to whole degrees.
export function parseForecast(json: unknown): Forecast {
  const body = objectOf(json);
  const current = objectOf(body['current']);
  const daily = objectOf(body['daily']);
  const dates = listOf(daily['time']);
  const codes = listOf(daily['weather_code']);
  const highs = listOf(daily['temperature_2m_max']);
  const lows = listOf(daily['temperature_2m_min']);
  // One entry per day in every list: a short one would pair a date with another day's number.
  if (dates.length === 0 || [codes, highs, lows].some((list) => list.length !== dates.length)) {
    throw new Error('Open-Meteo sent daily lists that do not line up');
  }
  return {
    current: {
      temperature: Math.round(numberOf(current['temperature_2m'])),
      code: numberOf(current['weather_code']),
      isDay: numberOf(current['is_day']) === 1,
    },
    days: dates.map((date, index) => ({
      date: dateOf(date),
      high: Math.round(numberOf(highs[index])),
      low: Math.round(numberOf(lows[index])),
      code: numberOf(codes[index]),
    })),
  };
}

// Open-Meteo's geocoding JSON as places, coordinates as sent (the database rounds them when they
// are saved). It sends no `results` at all when nothing matched. A match carries no region or
// country when Open-Meteo has none for it.
export function parsePlaces(json: unknown): PlaceMatch[] {
  const body = objectOf(json);
  if (body['results'] === undefined) return [];
  return listOf(body['results']).map((entry) => {
    const place = objectOf(entry);
    const region = place['admin1'];
    const country = place['country'];
    return {
      name: textOf(place['name']),
      region: typeof region === 'string' && region !== '' ? region : null,
      country: typeof country === 'string' && country !== '' ? country : null,
      latitude: numberOf(place['latitude']),
      longitude: numberOf(place['longitude']),
    };
  });
}

// A match as the picker words it, and as the Household stores it: "Austin, Texas, United States".
export function describePlace(place: PlaceMatch): string {
  return [place.name, place.region, place.country].filter((part) => part !== null).join(', ');
}

// The forecast's day for a Household date ('YYYY-MM-DD'), or undefined when it does not cover it.
export function forecastDay(forecast: Forecast | null, date: string): ForecastDay | undefined {
  return forecast?.days.find((day) => day.date === date);
}

// How long a reading may be called current. A Wall that has been cut off for longer must not pass
// an old temperature off as what it is outside now.
export const CURRENT_MAX_AGE_MS = 2 * 60 * 60_000;

// What a forecast read at `fetchedAt` may still show at `now` (both in ms): the days always, since
// each is keyed by its date, but the current conditions only while the reading is at most two hours old.
export function forecastToShow(forecast: Forecast, fetchedAt: number, now: number): Forecast {
  return now - fetchedAt > CURRENT_MAX_AGE_MS ? { ...forecast, current: null } : forecast;
}

// ---- Words and pictures -------------------------------------------------------------

// The WMO weather codes Open-Meteo sends, grouped as plain words. Clear, mostly clear and partly
// cloudy are not here: they change picture with the light.
const CONDITIONS: { codes: number[]; words: string; icon: WeatherIcon }[] = [
  { codes: [3], words: 'Cloudy', icon: 'cloud' },
  { codes: [45, 48], words: 'Fog', icon: 'fog' },
  { codes: [51, 53, 55, 56, 57], words: 'Drizzle', icon: 'drizzle' },
  { codes: [61, 63, 65, 66, 67, 80, 81, 82], words: 'Rain', icon: 'rain' },
  { codes: [71, 73, 75, 77, 85, 86], words: 'Snow', icon: 'snow' },
  { codes: [95, 96, 99], words: 'Thunderstorm', icon: 'thunderstorm' },
];

// What a weather code says in words and shows as a picture. Night swaps the sun for the moon;
// a code that is not known says so, with the plain cloud.
export function describeWeather(code: number, isDay = true): { words: string; icon: WeatherIcon } {
  if (code === 0) return { words: 'Clear', icon: isDay ? 'sun' : 'moon' };
  if (code === 1 || code === 2) return { words: code === 1 ? 'Mostly clear' : 'Partly cloudy', icon: isDay ? 'cloud-sun' : 'cloud-moon' };
  const found = CONDITIONS.find((condition) => condition.codes.includes(code));
  return found ? { words: found.words, icon: found.icon } : { words: 'Unknown', icon: 'cloud' };
}

// ---- The network --------------------------------------------------------------------

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Open-Meteo answered ${response.status}`);
  return response.json();
}

export async function fetchForecast(latitude: number, longitude: number, unit: TemperatureUnit, timezone: string): Promise<Forecast> {
  return parseForecast(await getJson(forecastUrl(latitude, longitude, unit, timezone)));
}

export async function searchPlaces(name: string): Promise<PlaceMatch[]> {
  return parsePlaces(await getJson(geocodingUrl(name)));
}
