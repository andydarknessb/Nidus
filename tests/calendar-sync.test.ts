import { afterEach, describe, expect, it } from 'vitest';
import {
  GOOGLE_TOKEN_URL,
  handleCalendarSync,
  syncWindow,
  type SyncDeps,
  type SyncSummary,
} from '../supabase/functions/calendar-sync/handler';
import { arrangeCalendar, arrangeEvents } from './support/calendar';
import { asHouseholdAccount, asServiceRole, createHousehold, destroyHousehold, type HouseholdAccount } from './support/supabase';

const SECRET = 'sync-secret-that-is-long-enough-to-matter';
const NOW = Date.parse('2026-09-30T12:00:00Z');

type GoogleEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
};

// Google's HTTP API is the only fake: a token endpoint and a calendar's events endpoint.
// `events` is keyed by Google calendar id; a number is an HTTP failure status for that calendar.
type FakeOptions = {
  events: Record<string, GoogleEvent[] | number>;
  // refresh token -> true when Google still honours it.
  refreshTokens?: Record<string, boolean>;
  pageSize?: number;
  syncToken?: string;
  // What an incremental request (one carrying a sync token) gets back, keyed by that token: the
  // changed events and the next token, or an HTTP failure status (410: the token expired).
  incremental?: Record<string, { items: GoogleEvent[]; nextSyncToken?: string } | number>;
};

type Call = { url: URL; init?: RequestInit };

function fakeGoogle(options: FakeOptions): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fake = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    calls.push(init ? { url, init } : { url });
    if (String(input) === GOOGLE_TOKEN_URL) {
      const form = new URLSearchParams(String(init?.body));
      const refresh = form.get('refresh_token') ?? '';
      if (form.get('grant_type') !== 'refresh_token' || options.refreshTokens?.[refresh] === false) {
        return Promise.resolve(Response.json({ error: 'invalid_grant' }, { status: 400 }));
      }
      return Promise.resolve(Response.json({ access_token: `access-for-${refresh}`, expires_in: 3600 }));
    }
    const match = /\/calendars\/([^/]+)\/events$/.exec(url.pathname);
    if (!match) return Promise.resolve(new Response('unexpected', { status: 500 }));
    const calendarId = decodeURIComponent(match[1]!);
    const given = url.searchParams.get('syncToken');
    if (given !== null) {
      // Google refuses a delta that also names a window.
      if (url.searchParams.has('timeMin') || url.searchParams.has('timeMax')) return Promise.resolve(new Response('{}', { status: 400 }));
      const delta = options.incremental?.[given];
      if (delta === undefined) return Promise.resolve(new Response('{}', { status: 410 }));
      if (typeof delta === 'number') return Promise.resolve(new Response('{}', { status: delta }));
      return Promise.resolve(Response.json({ items: delta.items, nextSyncToken: delta.nextSyncToken ?? 'sync-token-next' }));
    }
    const events = options.events[calendarId];
    if (events === undefined) return Promise.resolve(new Response('{}', { status: 404 }));
    if (typeof events === 'number') return Promise.resolve(new Response('{}', { status: events }));
    const size = options.pageSize ?? 1000;
    const offset = Number(url.searchParams.get('pageToken') ?? 0);
    const items = events.slice(offset, offset + size);
    const more = offset + size < events.length;
    return Promise.resolve(
      Response.json({
        items,
        ...(more ? { nextPageToken: String(offset + size) } : { nextSyncToken: options.syncToken ?? 'sync-token-1' }),
      }),
    );
  };
  return { fetch: fake as typeof fetch, calls };
}

// Scoped to the test's own Household: the local stack is shared, and a sync of everyone's accounts
// would touch (and count) accounts other runs left there.
function deps(account: HouseholdAccount, google: { fetch: typeof fetch }): SyncDeps {
  return {
    env: { syncSecret: SECRET, googleClientId: 'client-id', googleClientSecret: 'client-secret' },
    admin: asServiceRole(),
    fetch: google.fetch,
    now: () => NOW,
    householdId: account.household.id,
  };
}

async function runSync(d: SyncDeps, secret: string | null = SECRET, method = 'POST'): Promise<Response> {
  const headers: Record<string, string> = secret === null ? {} : { 'x-sync-secret': secret };
  return handleCalendarSync(new Request('https://nidus.test/functions/v1/calendar-sync', { method, headers }), d);
}

async function syncOk(d: SyncDeps): Promise<SyncSummary> {
  const response = await runSync(d);
  expect(response.status).toBe(200);
  return (await response.json()) as SyncSummary;
}

let households: HouseholdAccount[] = [];

afterEach(async () => {
  for (const account of households) await destroyHousehold(account);
  households = [];
});

async function arrange(): Promise<HouseholdAccount> {
  const account = await createHousehold();
  households.push(account);
  return account;
}

async function rowsOf(calendarId: string) {
  const { data, error } = await asServiceRole()
    .from('synced_events')
    .select('id, google_event_id, title, description, location, starts_at, ends_at, is_all_day, household_id')
    .eq('mirrored_calendar_id', calendarId)
    .order('starts_at')
    .order('google_event_id');
  if (error) throw error;
  return data;
}

async function accountOf(accountId: string) {
  const { data, error } = await asServiceRole()
    .from('calendar_accounts')
    .select('status, last_synced_at, last_error')
    .eq('id', accountId)
    .single<{ status: string; last_synced_at: string | null; last_error: string | null }>();
  if (error) throw error;
  return data;
}

const standup: GoogleEvent = {
  id: 'standup',
  summary: 'Standup',
  description: 'Daily',
  location: 'Kitchen',
  start: { dateTime: '2026-10-05T09:00:00-05:00' },
  end: { dateTime: '2026-10-05T09:30:00-05:00' },
};

describe('who may run it', () => {
  it('refuses a request without the sync secret, with a wrong one, or that is not a POST', async () => {
    const account = await arrange();
    const google = fakeGoogle({ events: {} });
    expect((await runSync(deps(account, google), null)).status).toBe(401);
    expect((await runSync(deps(account, google), 'wrong')).status).toBe(401);
    expect((await runSync(deps(account, google), SECRET, 'GET')).status).toBe(405);
    expect(google.calls).toEqual([]);
  });
});

describe('a full sync', () => {
  it('asks Google for the selected calendar over the window with recurring events expanded', async () => {
    const account = await arrange();
    const { calendarId } = await arrangeCalendar(account, { googleCalendarId: 'family@group.calendar.google.com', refreshToken: 'refresh-A' });
    const google = fakeGoogle({ events: { 'family@group.calendar.google.com': [standup] } });

    await syncOk(deps(account, google));

    const token = google.calls.find((call) => String(call.url) === GOOGLE_TOKEN_URL)!;
    const form = new URLSearchParams(String(token.init?.body));
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('refresh_token')).toBe('refresh-A');
    expect(form.get('client_id')).toBe('client-id');

    const request = google.calls.find((call) => call.url.pathname.endsWith('/events'))!;
    expect(request.url.pathname).toBe('/calendar/v3/calendars/family%40group.calendar.google.com/events');
    expect(request.url.searchParams.get('singleEvents')).toBe('true');
    expect(request.url.searchParams.get('timeMin')).toBe('2026-08-30T12:00:00.000Z');
    expect(request.url.searchParams.get('timeMax')).toBe('2027-03-30T12:00:00.000Z');
    expect(new Headers(request.init?.headers).get('Authorization')).toBe('Bearer access-for-refresh-A');
    expect(await rowsOf(calendarId)).toHaveLength(1);
  });

  it('stores a timed event as an instant with its title, notes and place', async () => {
    const account = await arrange();
    const { calendarId } = await arrangeCalendar(account, { googleCalendarId: 'cal' });
    await syncOk(deps(account, fakeGoogle({ events: { cal: [standup] } })));

    expect(await rowsOf(calendarId)).toEqual([
      expect.objectContaining({
        google_event_id: 'standup',
        title: 'Standup',
        description: 'Daily',
        location: 'Kitchen',
        starts_at: '2026-10-05T14:00:00+00:00',
        ends_at: '2026-10-05T14:30:00+00:00',
        is_all_day: false,
        household_id: account.household.id,
      }),
    ]);
  });

  it('stores the occurrences of a recurring event as separate rows', async () => {
    const account = await arrange();
    const { calendarId } = await arrangeCalendar(account, { googleCalendarId: 'cal' });
    const weekly = ['20261005', '20261012', '20261019'].map(
      (day): GoogleEvent => ({
        id: `swim_${day}T220000Z`,
        summary: 'Swim practice',
        start: { dateTime: `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}T17:00:00-05:00` },
        end: { dateTime: `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}T18:00:00-05:00` },
      }),
    );
    await syncOk(deps(account, fakeGoogle({ events: { cal: weekly } })));

    const rows = await rowsOf(calendarId);
    expect(rows.map((row) => row.starts_at)).toEqual(['2026-10-05T22:00:00+00:00', '2026-10-12T22:00:00+00:00', '2026-10-19T22:00:00+00:00']);
    expect(new Set(rows.map((row) => row.title))).toEqual(new Set(['Swim practice']));
  });

  it('stores an all-day event from Household midnight to Household midnight', async () => {
    const account = await arrange(); // America/Chicago, CDT until Nov 1
    const { calendarId } = await arrangeCalendar(account, { googleCalendarId: 'cal' });
    await syncOk(
      deps(account, fakeGoogle({ events: { cal: [{ id: 'holiday', summary: 'Columbus Day', start: { date: '2026-10-12' }, end: { date: '2026-10-13' } }] } })),
    );

    expect(await rowsOf(calendarId)).toEqual([
      expect.objectContaining({ is_all_day: true, starts_at: '2026-10-12T05:00:00+00:00', ends_at: '2026-10-13T05:00:00+00:00' }),
    ]);
  });

  it('stores a multi-day all-day event across every day, through a daylight saving change', async () => {
    const account = await arrange();
    const { calendarId } = await arrangeCalendar(account, { googleCalendarId: 'cal' });
    await syncOk(
      deps(account, fakeGoogle({ events: { cal: [{ id: 'trip', summary: 'Grandma’s', start: { date: '2026-10-30' }, end: { date: '2026-11-03' } }] } })),
    );

    // Oct 30 midnight is CDT (UTC-5); Nov 3 midnight is CST (UTC-6).
    expect(await rowsOf(calendarId)).toEqual([
      expect.objectContaining({ is_all_day: true, starts_at: '2026-10-30T05:00:00+00:00', ends_at: '2026-11-03T06:00:00+00:00' }),
    ]);
  });

  it('stores a timed event that runs past midnight as one row', async () => {
    const account = await arrange();
    const { calendarId } = await arrangeCalendar(account, { googleCalendarId: 'cal' });
    await syncOk(
      deps(account,
        fakeGoogle({
          events: { cal: [{ id: 'party', summary: 'Sleepover', start: { dateTime: '2026-10-09T20:00:00-05:00' }, end: { dateTime: '2026-10-10T10:00:00-05:00' } }] },
        }),
      ),
    );

    expect(await rowsOf(calendarId)).toEqual([expect.objectContaining({ starts_at: '2026-10-10T01:00:00+00:00', ends_at: '2026-10-10T15:00:00+00:00', is_all_day: false })]);
  });

  it('reads every page, keeps the returned sync token and marks the account synced', async () => {
    const account = await arrange();
    const { calendarId, accountId } = await arrangeCalendar(account, { googleCalendarId: 'cal' });
    const many = Array.from(
      { length: 5 },
      (_, index): GoogleEvent => ({ id: `e${index}`, summary: `Event ${index}`, start: { dateTime: `2026-10-0${index + 1}T10:00:00Z` }, end: { dateTime: `2026-10-0${index + 1}T11:00:00Z` } }),
    );
    const summary = await syncOk(deps(account, fakeGoogle({ events: { cal: many }, pageSize: 2, syncToken: 'token-xyz' })));

    expect(await rowsOf(calendarId)).toHaveLength(5);
    expect(summary).toMatchObject({ accounts: 1, calendars: 1, events: 5, errors: [] });
    const { data } = await asServiceRole().from('mirrored_calendars').select('sync_token').eq('id', calendarId).single<{ sync_token: string }>();
    expect(data?.sync_token).toBe('token-xyz');
    const synced = await accountOf(accountId);
    expect(new Date(synced.last_synced_at!).getTime()).toBe(NOW);
    expect(synced).toMatchObject({ status: 'active', last_error: null });
  });

  it('names an event with no title, and skips cancelled ones and ones it cannot place', async () => {
    const account = await arrange();
    const { calendarId } = await arrangeCalendar(account, { googleCalendarId: 'cal' });
    await syncOk(
      deps(account,
        fakeGoogle({
          events: {
            cal: [
              { id: 'blank', start: { dateTime: '2026-10-05T10:00:00Z' }, end: { dateTime: '2026-10-05T11:00:00Z' } },
              { id: 'gone', status: 'cancelled', summary: 'Cancelled', start: { dateTime: '2026-10-05T10:00:00Z' }, end: { dateTime: '2026-10-05T11:00:00Z' } },
              { id: 'nowhen', summary: 'No time' },
            ],
          },
        }),
      ),
    );

    expect((await rowsOf(calendarId)).map((row) => [row.google_event_id, row.title])).toEqual([['blank', '(No title)']]);
  });
});

describe('syncing again', () => {
  it('updates what changed in place and leaves the rest', async () => {
    const account = await arrange();
    const { calendarId } = await arrangeCalendar(account, { googleCalendarId: 'cal' });
    await syncOk(deps(account, fakeGoogle({ events: { cal: [standup] } })));
    const [before] = await rowsOf(calendarId);

    await syncOk(deps(account, fakeGoogle({ events: { cal: [{ ...standup, summary: 'Standup moved', start: { dateTime: '2026-10-05T10:00:00-05:00' }, end: { dateTime: '2026-10-05T10:30:00-05:00' } }] } })));

    const rows = await rowsOf(calendarId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: before!.id, title: 'Standup moved', starts_at: '2026-10-05T15:00:00+00:00' });
  });

  it('deletes an occurrence that is gone or cancelled', async () => {
    const account = await arrange();
    const { calendarId } = await arrangeCalendar(account, { googleCalendarId: 'cal' });
    const second: GoogleEvent = { ...standup, id: 'second', summary: 'Second' };
    await syncOk(deps(account, fakeGoogle({ events: { cal: [standup, second] } })));
    expect(await rowsOf(calendarId)).toHaveLength(2);

    await syncOk(deps(account, fakeGoogle({ events: { cal: [standup, { ...second, status: 'cancelled' }] } })));
    expect((await rowsOf(calendarId)).map((row) => row.google_event_id)).toEqual(['standup']);

    await syncOk(deps(account, fakeGoogle({ events: { cal: [] } })));
    expect(await rowsOf(calendarId)).toEqual([]);
  });

  it('never asks Google for a calendar that is not selected', async () => {
    const account = await arrange();
    await arrangeCalendar(account, { googleCalendarId: 'cal', selected: false });
    const google = fakeGoogle({ events: { cal: [standup] } });

    await syncOk(deps(account, google));

    expect(google.calls.filter((call) => call.url.pathname.endsWith('/events'))).toEqual([]);
  });
});

const OCT_5_AFTERNOON = '2026-10-05T14:00:00Z';
const ISO_NOW = new Date(NOW).toISOString();
const EARLIER_TODAY = new Date(NOW - 2 * 60 * 60 * 1000).toISOString();

function stored(id: string, title: string, startsAt = OCT_5_AFTERNOON) {
  return { google_event_id: id, title, starts_at: startsAt, ends_at: new Date(Date.parse(startsAt) + 3600_000).toISOString() };
}

function timed(id: string, summary: string, start: string, end: string): GoogleEvent {
  return { id, summary, start: { dateTime: start }, end: { dateTime: end } };
}

async function calendarState(calendarId: string) {
  const { data, error } = await asServiceRole()
    .from('mirrored_calendars')
    .select('sync_token, last_full_sync_at')
    .eq('id', calendarId)
    .single<{ sync_token: string | null; last_full_sync_at: string | null }>();
  if (error) throw error;
  return data;
}

function eventCalls(google: { calls: Call[] }): Call[] {
  return google.calls.filter((call) => call.url.pathname.endsWith('/events'));
}

describe('an incremental sync', () => {
  it('asks only for changes since the sync token, with no window', async () => {
    const account = await arrange();
    const { calendarId } = await arrangeCalendar(account, { googleCalendarId: 'cal' });
    await arrangeEvents(calendarId, [stored('a', 'A')], { syncToken: 'tok-1', fullSyncAt: EARLIER_TODAY });
    const google = fakeGoogle({ events: { cal: [] }, incremental: { 'tok-1': { items: [], nextSyncToken: 'tok-2' } } });

    await syncOk(deps(account, google));

    const [request, ...rest] = eventCalls(google);
    expect(rest).toEqual([]);
    expect(request!.url.searchParams.get('syncToken')).toBe('tok-1');
    expect(request!.url.searchParams.get('singleEvents')).toBe('true');
    expect(request!.url.searchParams.has('timeMin')).toBe(false);
    expect(request!.url.searchParams.has('timeMax')).toBe(false);
    expect((await calendarState(calendarId)).sync_token).toBe('tok-2');
    expect(await rowsOf(calendarId)).toHaveLength(1);
  });

  it('moves and renames an event in place, adds a new one and removes a cancelled one, leaving the rest', async () => {
    const account = await arrange();
    const { calendarId, accountId } = await arrangeCalendar(account, { googleCalendarId: 'cal' });
    await arrangeEvents(calendarId, [stored('move', 'Dentist'), stored('cancel', 'Piano'), stored('same', 'Untouched', '2026-10-07T14:00:00Z')], {
      syncToken: 'tok-1',
      fullSyncAt: EARLIER_TODAY,
    });
    const before = await rowsOf(calendarId);
    const google = fakeGoogle({
      events: {},
      incremental: {
        'tok-1': {
          nextSyncToken: 'tok-2',
          items: [
            timed('move', 'Dentist (new time)', '2026-10-06T10:00:00-05:00', '2026-10-06T11:00:00-05:00'),
            { id: 'cancel', status: 'cancelled' },
            timed('fresh', 'Soccer', '2026-10-08T17:00:00-05:00', '2026-10-08T18:00:00-05:00'),
          ],
        },
      },
    });

    const summary = await syncOk(deps(account, google));

    const rows = await rowsOf(calendarId);
    expect(rows.map((row) => [row.google_event_id, row.title, row.starts_at])).toEqual([
      ['move', 'Dentist (new time)', '2026-10-06T15:00:00+00:00'],
      ['same', 'Untouched', '2026-10-07T14:00:00+00:00'],
      ['fresh', 'Soccer', '2026-10-08T22:00:00+00:00'],
    ]);
    expect(rows.find((row) => row.google_event_id === 'move')!.id).toBe(before.find((row) => row.google_event_id === 'move')!.id);
    expect(rows.find((row) => row.google_event_id === 'same')!.id).toBe(before.find((row) => row.google_event_id === 'same')!.id);
    expect(summary).toMatchObject({ accounts: 1, calendars: 1, errors: [] });
    expect(new Date((await accountOf(accountId)).last_synced_at!).getTime()).toBe(NOW);
  });

  it('removes one cancelled occurrence of a recurring event and keeps the others', async () => {
    const account = await arrange();
    const { calendarId } = await arrangeCalendar(account, { googleCalendarId: 'cal' });
    await arrangeEvents(
      calendarId,
      ['20261005', '20261012', '20261019'].map((day) => stored(`swim_${day}T220000Z`, 'Swim practice', `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}T22:00:00Z`)),
      { syncToken: 'tok-1', fullSyncAt: EARLIER_TODAY },
    );
    const google = fakeGoogle({ events: {}, incremental: { 'tok-1': { items: [{ id: 'swim_20261012T220000Z', status: 'cancelled' }] } } });

    await syncOk(deps(account, google));

    expect((await rowsOf(calendarId)).map((row) => row.google_event_id)).toEqual(['swim_20261005T220000Z', 'swim_20261019T220000Z']);
  });

  it('removes an event that moved outside the window, and ignores a new one outside it', async () => {
    const account = await arrange();
    const { calendarId } = await arrangeCalendar(account, { googleCalendarId: 'cal' });
    await arrangeEvents(calendarId, [stored('kept', 'Kept'), stored('leaves', 'Leaves')], { syncToken: 'tok-1', fullSyncAt: EARLIER_TODAY });
    const google = fakeGoogle({
      events: {},
      incremental: {
        'tok-1': {
          items: [
            timed('leaves', 'Leaves', '2027-09-01T10:00:00Z', '2027-09-01T11:00:00Z'),
            timed('years-away', 'Far off', '2029-01-01T10:00:00Z', '2029-01-01T11:00:00Z'),
            timed('long-ago', 'Long ago', '2024-01-01T10:00:00Z', '2024-01-01T11:00:00Z'),
          ],
        },
      },
    });

    await syncOk(deps(account, google));

    expect((await rowsOf(calendarId)).map((row) => row.google_event_id)).toEqual(['kept']);
  });

  it('reads every page of a delta before it stores the new token', async () => {
    const account = await arrange();
    const { calendarId } = await arrangeCalendar(account, { googleCalendarId: 'cal' });
    await arrangeEvents(calendarId, [stored('a', 'A')], { syncToken: 'tok-1', fullSyncAt: EARLIER_TODAY });
    const items = Array.from({ length: 5 }, (_, index) => timed(`n${index}`, `New ${index}`, `2026-10-1${index}T10:00:00Z`, `2026-10-1${index}T11:00:00Z`));
    const google = fakeGoogle({ events: {}, pageSize: 2, incremental: { 'tok-1': { items, nextSyncToken: 'tok-9' } } });

    await syncOk(deps(account, google));

    expect(await rowsOf(calendarId)).toHaveLength(6);
    expect((await calendarState(calendarId)).sync_token).toBe('tok-9');
  });

  it('keeps the old rows and the old token when the delta fails, so the next run tries it again', async () => {
    const account = await arrange();
    const { calendarId, accountId } = await arrangeCalendar(account, { googleCalendarId: 'cal' });
    await arrangeEvents(calendarId, [stored('a', 'A')], { syncToken: 'tok-1', fullSyncAt: EARLIER_TODAY });

    const summary = await syncOk(deps(account, fakeGoogle({ events: {}, incremental: { 'tok-1': 503 } })));

    expect((await rowsOf(calendarId)).map((row) => row.google_event_id)).toEqual(['a']);
    expect((await calendarState(calendarId)).sync_token).toBe('tok-1');
    expect(summary.errors).toHaveLength(1);
    expect((await accountOf(accountId)).last_error).toMatch(/503/);
  });

  it('reads the whole calendar again once a day, to pick up occurrences that slid into the window', async () => {
    const account = await arrange();
    const { calendarId } = await arrangeCalendar(account, { googleCalendarId: 'cal' });
    const yesterday = new Date(NOW - 25 * 60 * 60 * 1000).toISOString();
    await arrangeEvents(calendarId, [stored('old', 'Old')], { syncToken: 'tok-1', fullSyncAt: yesterday });
    const google = fakeGoogle({ events: { cal: [standup] }, syncToken: 'tok-fresh', incremental: { 'tok-1': { items: [] } } });

    await syncOk(deps(account, google));

    const [request] = eventCalls(google);
    expect(request!.url.searchParams.has('syncToken')).toBe(false);
    expect(request!.url.searchParams.has('timeMin')).toBe(true);
    expect((await rowsOf(calendarId)).map((row) => row.google_event_id)).toEqual(['standup']);
    const state = await calendarState(calendarId);
    expect(state.sync_token).toBe('tok-fresh');
    expect(new Date(state.last_full_sync_at!).getTime()).toBe(NOW);
  });

  it('does a full sync, not a delta, for a calendar that has no sync token yet', async () => {
    const account = await arrange();
    const { calendarId } = await arrangeCalendar(account, { googleCalendarId: 'cal' });
    const google = fakeGoogle({ events: { cal: [standup] }, syncToken: 'tok-first' });

    await syncOk(deps(account, google));

    expect(eventCalls(google)[0]!.url.searchParams.has('syncToken')).toBe(false);
    expect(await calendarState(calendarId)).toMatchObject({ sync_token: 'tok-first' });
  });
});

describe('when Google says the sync token is gone (410)', () => {
  it('clears the token and replaces the calendar with a full read, in one go', async () => {
    const account = await arrange();
    const { calendarId } = await arrangeCalendar(account, { googleCalendarId: 'cal' });
    await arrangeEvents(calendarId, [stored('stale', 'Stale'), stored('standup', 'Old title')], { syncToken: 'expired', fullSyncAt: EARLIER_TODAY });
    const google = fakeGoogle({ events: { cal: [standup] }, syncToken: 'tok-after-410', incremental: { expired: 410 } });

    const summary = await syncOk(deps(account, google));

    const [delta, full, ...rest] = eventCalls(google);
    expect(rest).toEqual([]);
    expect(delta!.url.searchParams.get('syncToken')).toBe('expired');
    expect(full!.url.searchParams.has('syncToken')).toBe(false);
    expect(full!.url.searchParams.get('timeMin')).toBe('2026-08-30T12:00:00.000Z');
    expect((await rowsOf(calendarId)).map((row) => [row.google_event_id, row.title])).toEqual([['standup', 'Standup']]);
    expect(await calendarState(calendarId)).toMatchObject({ sync_token: 'tok-after-410' });
    expect(summary).toMatchObject({ calendars: 1, errors: [] });
  });

  it('never leaves the wall a partly emptied calendar: if the full read fails too, every old row is still there and the token is cleared', async () => {
    const account = await arrange();
    const { calendarId, accountId } = await arrangeCalendar(account, { googleCalendarId: 'cal' });
    await arrangeEvents(calendarId, [stored('a', 'A'), stored('b', 'B')], { syncToken: 'expired', fullSyncAt: EARLIER_TODAY });
    // The delta says 410; then the full read of the same calendar fails.
    const base = fakeGoogle({ events: { cal: 503 }, incremental: { expired: 410 } });

    const summary = await syncOk(deps(account, base));

    expect((await rowsOf(calendarId)).map((row) => row.google_event_id)).toEqual(['a', 'b']);
    expect((await calendarState(calendarId)).sync_token).toBeNull();
    expect(summary.errors).toHaveLength(1);
    expect((await accountOf(accountId)).last_error).toMatch(/503/);
  });

  it('replaces a calendar that is empty in Google by emptying it, in the same transaction as the token', async () => {
    const account = await arrange();
    const { calendarId } = await arrangeCalendar(account, { googleCalendarId: 'cal' });
    await arrangeEvents(calendarId, [stored('a', 'A')], { syncToken: 'expired', fullSyncAt: EARLIER_TODAY });

    await syncOk(deps(account, fakeGoogle({ events: { cal: [] }, syncToken: 'tok-new', incremental: { expired: 410 } })));

    expect(await rowsOf(calendarId)).toEqual([]);
    expect((await calendarState(calendarId)).sync_token).toBe('tok-new');
  });
});

describe('deselecting and reselecting a Mirrored Calendar', () => {
  it('removes its events the moment the Household Account deselects it, with no sync run', async () => {
    const account = await arrange();
    const { calendarId } = await arrangeCalendar(account, { googleCalendarId: 'cal' });
    await arrangeEvents(calendarId, [stored('a', 'A'), stored('b', 'B')], { syncToken: 'tok-1', fullSyncAt: EARLIER_TODAY });
    const phone = await asHouseholdAccount(account);

    const { error } = await phone.from('mirrored_calendars').update({ selected: false }).eq('id', calendarId);

    expect(error).toBeNull();
    expect(await rowsOf(calendarId)).toEqual([]);
    expect(await calendarState(calendarId)).toEqual({ sync_token: null, last_full_sync_at: null });
  });

  it('keeps the other calendars events when one is deselected', async () => {
    const account = await arrange();
    const first = await arrangeCalendar(account, { googleCalendarId: 'one', email: 'one@example.test' });
    const second = await arrangeCalendar(account, { googleCalendarId: 'two', email: 'two@example.test' });
    await arrangeEvents(first.calendarId, [stored('a', 'A')]);
    await arrangeEvents(second.calendarId, [stored('b', 'B')]);

    await asServiceRole().from('mirrored_calendars').update({ selected: false }).eq('id', first.calendarId);

    expect(await rowsOf(first.calendarId)).toEqual([]);
    expect(await rowsOf(second.calendarId)).toHaveLength(1);
  });

  it('does a full sync of the calendar on the next run after it is reselected', async () => {
    const account = await arrange();
    const { calendarId } = await arrangeCalendar(account, { googleCalendarId: 'cal' });
    await arrangeEvents(calendarId, [stored('a', 'A')], { syncToken: 'tok-1', fullSyncAt: EARLIER_TODAY });
    const phone = await asHouseholdAccount(account);
    await phone.from('mirrored_calendars').update({ selected: false }).eq('id', calendarId);
    await phone.from('mirrored_calendars').update({ selected: true }).eq('id', calendarId);
    const google = fakeGoogle({ events: { cal: [standup] }, syncToken: 'tok-again', incremental: { 'tok-1': { items: [] } } });

    await syncOk(deps(account, google));

    const [request, ...rest] = eventCalls(google);
    expect(rest).toEqual([]);
    expect(request!.url.searchParams.has('syncToken')).toBe(false);
    expect((await rowsOf(calendarId)).map((row) => row.google_event_id)).toEqual(['standup']);
  });

  it('does not let a sync that began before the deselect write its events after it', async () => {
    const account = await arrange();
    const { calendarId } = await arrangeCalendar(account, { googleCalendarId: 'cal', selected: true });
    await asServiceRole().from('mirrored_calendars').update({ selected: false }).eq('id', calendarId);

    // What a sync would do with events it fetched while the calendar was still selected.
    const { error } = await asServiceRole().rpc('replace_synced_events', {
      p_mirrored_calendar_id: calendarId,
      p_events: [{ ...stored('late', 'Late'), description: null, location: null, is_all_day: false }],
      p_sync_token: 'late-token',
      p_synced_at: ISO_NOW,
    });
    const { error: deltaError } = await asServiceRole().rpc('apply_synced_event_changes', {
      p_mirrored_calendar_id: calendarId,
      p_upserts: [{ ...stored('late', 'Late'), description: null, location: null, is_all_day: false }],
      p_deleted_ids: [],
      p_sync_token: 'late-token',
    });

    expect(error).toBeNull();
    expect(deltaError).toBeNull();
    expect(await rowsOf(calendarId)).toEqual([]);
    expect((await calendarState(calendarId)).sync_token).toBeNull();
  });
});

describe('when Google says no', () => {
  it('marks an account whose refresh token was revoked as needing reauth, without touching its events', async () => {
    const account = await arrange();
    const { calendarId, accountId } = await arrangeCalendar(account, { googleCalendarId: 'cal', refreshToken: 'revoked' });
    await arrangeEvents(calendarId, [{ google_event_id: 'kept', title: 'Kept', starts_at: '2026-10-05T14:00:00Z', ends_at: '2026-10-05T15:00:00Z' }]);

    const summary = await syncOk(deps(account, fakeGoogle({ events: { cal: [standup] }, refreshTokens: { revoked: false } })));

    expect(await accountOf(accountId)).toMatchObject({ status: 'needs_reauth', last_synced_at: null });
    expect((await accountOf(accountId)).last_error).toMatch(/reconnect/i);
    expect((await rowsOf(calendarId)).map((row) => row.google_event_id)).toEqual(['kept']);
    expect(summary.errors).toHaveLength(1);
  });

  it('does not try an account that needs reauth, and still syncs the others', async () => {
    const account = await arrange();
    const broken = await arrangeCalendar(account, { googleCalendarId: 'broken', refreshToken: 'revoked' });
    const fine = await arrangeCalendar(account, { googleCalendarId: 'fine', refreshToken: 'good' });
    const google = fakeGoogle({ events: { broken: [standup], fine: [standup] }, refreshTokens: { revoked: false } });
    await syncOk(deps(account, google));
    const tokenCalls = () => google.calls.filter((call) => String(call.url) === GOOGLE_TOKEN_URL).length;
    const before = tokenCalls();

    await syncOk(deps(account, google));

    expect(tokenCalls() - before).toBe(1);
    expect(await rowsOf(broken.calendarId)).toEqual([]);
    expect(await rowsOf(fine.calendarId)).toHaveLength(1);
    expect(await accountOf(fine.accountId)).toMatchObject({ status: 'active' });
  });

  it('marks an account needs_reauth when Google refuses the refresh token during an incremental run too', async () => {
    const account = await arrange();
    const { calendarId, accountId } = await arrangeCalendar(account, { googleCalendarId: 'cal', refreshToken: 'revoked' });
    await arrangeEvents(calendarId, [stored('kept', 'Kept')], { syncToken: 'tok-1', fullSyncAt: EARLIER_TODAY });

    await syncOk(deps(account, fakeGoogle({ events: {}, refreshTokens: { revoked: false }, incremental: { 'tok-1': { items: [] } } })));

    expect(await accountOf(accountId)).toMatchObject({ status: 'needs_reauth' });
    expect((await rowsOf(calendarId)).map((row) => row.google_event_id)).toEqual(['kept']);
    expect((await calendarState(calendarId)).sync_token).toBe('tok-1');
  });

  it('reconnecting a needs_reauth account updates its Vault secret in place, keeps its calendars and choices, and resumes syncing', async () => {
    const account = await arrange();
    const email = 'parent@example.test';
    const { calendarId, accountId } = await arrangeCalendar(account, { googleCalendarId: 'cal', email, refreshToken: 'revoked', color: '#3b82f6' });
    await arrangeEvents(calendarId, [stored('kept', 'Kept')], { syncToken: 'tok-1', fullSyncAt: EARLIER_TODAY });
    const google = fakeGoogle({ events: { cal: [standup] }, refreshTokens: { revoked: false, renewed: true }, incremental: { 'tok-1': { items: [], nextSyncToken: 'tok-2' } } });
    await syncOk(deps(account, google));
    const admin = asServiceRole();
    const secretOf = async () => {
      const { data } = await admin.from('calendar_accounts').select('vault_secret_id').eq('id', accountId).single<{ vault_secret_id: string }>();
      return data!.vault_secret_id;
    };
    const secretBefore = await secretOf();
    expect(await accountOf(accountId)).toMatchObject({ status: 'needs_reauth' });

    const { data: sameAccount, error } = await admin.rpc('store_calendar_account', { p_household_id: account.household.id, p_google_email: email, p_refresh_token: 'renewed' });

    expect(error).toBeNull();
    expect(sameAccount).toBe(accountId);
    expect(await secretOf()).toBe(secretBefore);
    expect(await accountOf(accountId)).toMatchObject({ status: 'active', last_error: null });
    const { data: calendar } = await admin.from('mirrored_calendars').select('selected, color').eq('id', calendarId).single();
    expect(calendar).toEqual({ selected: true, color: '#3b82f6' });

    await syncOk(deps(account, google));

    expect(await accountOf(accountId)).toMatchObject({ status: 'active', last_error: null });
    const tokenCalls = google.calls.filter((call) => String(call.url) === GOOGLE_TOKEN_URL);
    expect(new URLSearchParams(String(tokenCalls.at(-1)!.init?.body)).get('refresh_token')).toBe('renewed');
    expect((await calendarState(calendarId)).sync_token).toBe('tok-2');
  });

  it('keeps the previous events of a calendar Google fails to return, and syncs its sibling', async () => {
    const account = await arrange();
    const first = await arrangeCalendar(account, { googleCalendarId: 'flaky', email: 'one@example.test' });
    const second = await arrangeCalendar(account, { googleCalendarId: 'steady', email: 'two@example.test' });
    await arrangeEvents(first.calendarId, [{ google_event_id: 'kept', title: 'Kept', starts_at: '2026-10-05T14:00:00Z', ends_at: '2026-10-05T15:00:00Z' }]);

    const summary = await syncOk(deps(account, fakeGoogle({ events: { flaky: 503, steady: [standup] } })));

    expect((await rowsOf(first.calendarId)).map((row) => row.google_event_id)).toEqual(['kept']);
    expect(await rowsOf(second.calendarId)).toHaveLength(1);
    expect(summary.errors).toHaveLength(1);
    const failed = await accountOf(first.accountId);
    expect(failed).toMatchObject({ status: 'active', last_synced_at: null });
    expect(failed.last_error).toMatch(/503/);
    expect(await accountOf(second.accountId)).toMatchObject({ last_error: null });
  });
});

describe('the window', () => {
  it('runs from one month back to six months ahead', () => {
    expect(syncWindow(NOW)).toEqual({ timeMin: '2026-08-30T12:00:00.000Z', timeMax: '2027-03-30T12:00:00.000Z' });
  });

  it('stops at the end of a shorter month instead of spilling into the next', () => {
    // Mar 31 less a month is Feb 28 (not Mar 3); Aug 31 plus six months is Feb 28 (not Mar 3).
    expect(syncWindow(Date.parse('2026-03-31T08:30:00Z'))).toEqual({ timeMin: '2026-02-28T08:30:00.000Z', timeMax: '2026-09-30T08:30:00.000Z' });
    expect(syncWindow(Date.parse('2026-08-31T08:30:00Z'))).toEqual({ timeMin: '2026-07-31T08:30:00.000Z', timeMax: '2027-02-28T08:30:00.000Z' });
    // A leap year keeps the 29th.
    expect(syncWindow(Date.parse('2027-08-31T00:00:00Z')).timeMax).toBe('2028-02-29T00:00:00.000Z');
  });
});
