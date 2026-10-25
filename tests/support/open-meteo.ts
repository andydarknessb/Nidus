// The one fake Open-Meteo, for every test that drives the client's one outside HTTP (the forecast, the place search). It is
// injected as the `fetch` that fetchForecast and searchPlaces take, as fakeGoogle is the Edge Functions'. It answers from
// Open-Meteo's recorded answers (tests/fixtures) and logs every request it was asked.
import { readFileSync } from 'node:fs';

// Open-Meteo's real answers, recorded once and read here as data.
export function recorded(name: string) {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'));
}

// What an endpoint answers: its JSON, an HTTP failure status, or null for no answer at all (a connection that fails). Read at each
// request, so a test changes it between reads (a good answer, then the service down).
export type OpenMeteoAnswer = unknown | number | null;

export type OpenMeteoFixtures = { forecast?: OpenMeteoAnswer; places?: OpenMeteoAnswer };

export type OpenMeteoCall = { url: URL; init?: RequestInit };

export function fakeOpenMeteo(fixtures: OpenMeteoFixtures = {}): { fetch: typeof fetch; calls: OpenMeteoCall[] } {
  const calls: OpenMeteoCall[] = [];
  const answer = (given: OpenMeteoAnswer | undefined): Promise<Response> => {
    if (given === null) return Promise.reject(new TypeError('Failed to fetch'));
    if (typeof given === 'number') return Promise.resolve(new Response('{}', { status: given }));
    return Promise.resolve(Response.json(given ?? {}));
  };

  const fake = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    calls.push(init ? { url, init } : { url });
    if (url.hostname === 'api.open-meteo.com' && url.pathname === '/v1/forecast') return answer(fixtures.forecast);
    if (url.hostname === 'geocoding-api.open-meteo.com' && url.pathname === '/v1/search') return answer(fixtures.places);
    return Promise.resolve(new Response('unexpected', { status: 500 }));
  };
  return { fetch: fake as typeof fetch, calls };
}
