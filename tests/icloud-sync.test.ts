import { afterEach, describe, expect, it } from 'vitest';
import { FEED_TOO_LARGE_MESSAGE, FEED_TRUNCATED_MESSAGE, GOOGLE_TOKEN_URL, handleCalendarSync, type SyncDeps, type SyncSummary } from '../supabase/functions/calendar-sync/handler';
import { arrangeCalendar } from './support/calendar';
import { asHouseholdAccount, asServiceRole, createHousehold, destroyHousehold, type HouseholdAccount } from './support/supabase';

// The sync of an iPhone (iCloud) calendar through the one seam: the local stack, the service role
// the Edge Function runs as, and a fake feed server injected through the same `fetch` dependency
// the Google fake uses. Only HTTP is faked.

const SECRET = 'sync-secret-that-is-long-enough-to-matter';
const NOW = Date.parse('2026-09-30T12:00:00Z');
const GOOGLE_EVENTS = /\/calendars\/([^/]+)\/events$/;

// What a feed server says to a link: a feed with its validators, 304, or a failure.
type Reply = { text: string; etag?: string; lastModified?: string } | number | 'unreachable';

let linkCounter = 0;
const newLink = () => `https://p12-caldav.icloud.com/published/2/secret-token-${Date.now().toString(36)}-${(linkCounter += 1)}`;

type Call = { url: string; headers: Headers };

function fakeWorld(feeds: Map<string, Reply>, googleEvents: Record<string, unknown[]> = {}) {
  const calls: Call[] = [];
  const fake = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init?.headers) });
    if (url === GOOGLE_TOKEN_URL) return Response.json({ access_token: 'access', expires_in: 3600 });
    const google = GOOGLE_EVENTS.exec(new URL(url).pathname);
    if (google) return Response.json({ items: googleEvents[decodeURIComponent(google[1]!)] ?? [], nextSyncToken: 'g-token' });
    const reply = feeds.get(url);
    if (reply === undefined) return new Response('missing', { status: 404 });
    if (reply === 'unreachable') throw new TypeError(`fetch failed for ${url}`);
    if (typeof reply === 'number') return new Response('', { status: reply });
    const headers = new Headers();
    if (reply.etag) headers.set('ETag', reply.etag);
    if (reply.lastModified) headers.set('Last-Modified', reply.lastModified);
    const sent = new Headers(init?.headers);
    // A real server answers 304 to a validator it issued.
    if ((reply.etag && sent.get('If-None-Match') === reply.etag) || (!reply.etag && reply.lastModified && sent.get('If-Modified-Since') === reply.lastModified)) {
      return new Response(null, { status: 304 });
    }
    return new Response(reply.text, { headers });
  }) as typeof fetch;
  return { fetch: fake, calls };
}

const feedOf = (...events: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Apple Inc.//iPhone OS 18.0//EN', 'X-WR-CALNAME:Family', ...events, 'END:VCALENDAR', '']
    .join('\n')
    .replace(/\n/g, '\r\n');

const vevent = (uid: string, summary: string, lines: string) => `BEGIN:VEVENT\nUID:${uid}\nDTSTAMP:20260901T000000Z\nSUMMARY:${summary}\n${lines}\nEND:VEVENT`;

const dentist = vevent('dentist', 'Dentist', 'DTSTART:20261008T150000Z\nDTEND:20261008T160000Z');
const swim = vevent('swim', 'Swim', 'DTSTART:20261006T230000Z\nDTEND:20261007T000000Z\nRRULE:FREQ=WEEKLY;COUNT=3');

function deps(account: HouseholdAccount, world: { fetch: typeof fetch }): SyncDeps {
  return {
    env: { syncSecret: SECRET, googleClientId: 'client-id', googleClientSecret: 'client-secret' },
    admin: asServiceRole(),
    fetch: world.fetch,
    now: () => NOW,
    // A clock that never moves, so that no test here depends on how fast the machine is; the one
    // test of the time limit sets its own.
    clock: () => 0,
    householdId: account.household.id,
  };
}

async function syncOk(d: SyncDeps): Promise<SyncSummary> {
  const response = await handleCalendarSync(
    new Request('https://nidus.test/functions/v1/calendar-sync', { method: 'POST', headers: { 'x-sync-secret': SECRET } }),
    d,
  );
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

// An iPhone calendar as calendar-connect stores it: the link in Vault, its one Mirrored Calendar.
async function arrangeIcloud(account: HouseholdAccount, link: string, name = 'Family'): Promise<{ accountId: string; calendarId: string }> {
  const admin = asServiceRole();
  const { data: accountId, error } = await admin.rpc('store_icloud_calendar', { p_household_id: account.household.id, p_link: link, p_name: name });
  if (error || typeof accountId !== 'string') throw error ?? new Error('store_icloud_calendar returned nothing');
  const { data: calendar } = await admin.from('mirrored_calendars').select('id').eq('calendar_account_id', accountId).single<{ id: string }>();
  return { accountId, calendarId: calendar!.id };
}

async function rowsOf(calendarId: string) {
  const { data, error } = await asServiceRole()
    .from('synced_events')
    .select('google_event_id, title, starts_at, ends_at, is_all_day, household_id')
    .eq('mirrored_calendar_id', calendarId)
    .order('starts_at');
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

async function tokenOf(calendarId: string): Promise<string | null> {
  const { data } = await asServiceRole().from('mirrored_calendars').select('sync_token').eq('id', calendarId).single<{ sync_token: string | null }>();
  return data!.sync_token;
}

describe('a first sync of an iPhone calendar', () => {
  it('writes its occurrences for the right Mirrored Calendar, with its Profile, and never asks Google', async () => {
    const account = await arrange();
    const admin = asServiceRole();
    const { data: profile } = await admin
      .from('profiles')
      .insert({ household_id: account.household.id, name: 'Ava', color: '#2f6f4e' })
      .select('id')
      .single<{ id: string }>();
    const link = newLink();
    const other = newLink();
    const mine = await arrangeIcloud(account, link);
    const theirs = await arrangeIcloud(account, other, 'Work');
    await admin.from('mirrored_calendars').update({ profile_id: profile!.id }).eq('id', mine.calendarId);

    const world = fakeWorld(new Map<string, Reply>([[link, { text: feedOf(dentist, swim), etag: '"v1"' }], [other, { text: feedOf(), etag: '"w1"' }]]));
    const summary = await syncOk(deps(account, world));

    expect(summary).toMatchObject({ accounts: 2, calendars: 2, events: 4, errors: [] });
    expect(await rowsOf(mine.calendarId)).toEqual([
      { google_event_id: 'swim|2026-10-06T23:00:00.000Z', title: 'Swim', starts_at: '2026-10-06T23:00:00+00:00', ends_at: '2026-10-07T00:00:00+00:00', is_all_day: false, household_id: account.household.id },
      { google_event_id: 'dentist|2026-10-08T15:00:00.000Z', title: 'Dentist', starts_at: '2026-10-08T15:00:00+00:00', ends_at: '2026-10-08T16:00:00+00:00', is_all_day: false, household_id: account.household.id },
      { google_event_id: 'swim|2026-10-13T23:00:00.000Z', title: 'Swim', starts_at: '2026-10-13T23:00:00+00:00', ends_at: '2026-10-14T00:00:00+00:00', is_all_day: false, household_id: account.household.id },
      { google_event_id: 'swim|2026-10-20T23:00:00.000Z', title: 'Swim', starts_at: '2026-10-20T23:00:00+00:00', ends_at: '2026-10-21T00:00:00+00:00', is_all_day: false, household_id: account.household.id },
    ]);
    expect(await rowsOf(theirs.calendarId)).toEqual([]);

    // The wall reads them with the Profile they belong to.
    const phone = await asHouseholdAccount(account);
    const { data: seen } = await phone.from('calendar_occurrences').select('title, profile_id, calendar_name').eq('calendar_id', mine.calendarId);
    expect(seen).toHaveLength(4);
    expect(seen![0]).toMatchObject({ profile_id: profile!.id, calendar_name: 'Family' });

    expect(await accountOf(mine.accountId)).toMatchObject({ status: 'active', last_error: null });
    expect(Date.parse((await accountOf(mine.accountId)).last_synced_at!)).toBe(NOW);
    expect(JSON.parse((await tokenOf(mine.calendarId))!)).toEqual({ etag: '"v1"', lastModified: null });
    // Only the feed was asked, and only for its own link.
    expect(world.calls.map((call) => call.url).sort()).toEqual([link, other].sort());
  });

  it('reads the link in Apple’s own spelling, in the Household Timezone', async () => {
    const account = await arrange();
    // The Household's zone is Chicago: a floating 09:00 is 14:00Z in October.
    const { data: household } = await asServiceRole().from('households').select('timezone').eq('id', account.household.id).single<{ timezone: string }>();
    expect(household!.timezone).toBe('America/Chicago');
    const link = newLink();
    const { calendarId } = await arrangeIcloud(account, link);
    const world = fakeWorld(new Map<string, Reply>([[link, { text: feedOf(vevent('f', 'Floating', 'DTSTART:20261014T090000'), vevent('d', 'Birthday', 'DTSTART;VALUE=DATE:20261015')) }]]));
    await syncOk(deps(account, world));
    expect((await rowsOf(calendarId)).map((row) => [row.title, row.starts_at, row.is_all_day])).toEqual([
      ['Floating', '2026-10-14T14:00:00+00:00', false],
      ['Birthday', '2026-10-15T05:00:00+00:00', true],
    ]);
    expect(await tokenOf(calendarId)).toBeNull();
  });
});

describe('a later sync', () => {
  it('replaces the occurrences after the feed is edited, and a moved occurrence keeps its row', async () => {
    const account = await arrange();
    const link = newLink();
    const { calendarId } = await arrangeIcloud(account, link);
    const feeds = new Map<string, Reply>([[link, { text: feedOf(dentist, swim), etag: '"v1"' }]]);
    const world = fakeWorld(feeds);
    await syncOk(deps(account, world));
    const before = await rowsOf(calendarId);
    const original = before.find((row) => row.google_event_id === 'swim|2026-10-13T23:00:00.000Z')!;

    const moved = vevent('swim', 'Swim', 'RECURRENCE-ID:20261013T230000Z\nDTSTART:20261014T230000Z\nDTEND:20261015T000000Z');
    feeds.set(link, { text: feedOf(swim, moved), etag: '"v2"' });
    const summary = await syncOk(deps(account, world));

    expect(summary).toMatchObject({ calendars: 1, events: 3, errors: [] });
    const after = await rowsOf(calendarId);
    // The dentist is gone, the third swim moved a day without changing its key, the rest stayed.
    expect(after.map((row) => row.google_event_id)).toEqual([
      'swim|2026-10-06T23:00:00.000Z',
      'swim|2026-10-13T23:00:00.000Z',
      'swim|2026-10-20T23:00:00.000Z',
    ]);
    expect(after[1]!.starts_at).toBe('2026-10-14T23:00:00+00:00');
    expect(after[1]!.starts_at).not.toBe(original.starts_at);
    expect(JSON.parse((await tokenOf(calendarId))!)).toEqual({ etag: '"v2"', lastModified: null });
    // It asked with the validator it had stored.
    expect(world.calls.at(-1)!.headers.get('If-None-Match')).toBe('"v1"');
  });

  it('keeps the occurrences on a 304 and moves last_synced_at, clearing an old error', async () => {
    const account = await arrange();
    const link = newLink();
    const { accountId, calendarId } = await arrangeIcloud(account, link);
    const world = fakeWorld(new Map<string, Reply>([[link, { text: feedOf(dentist), etag: '"v1"', lastModified: 'Tue, 29 Sep 2026 10:00:00 GMT' }]]));
    const first = deps(account, world);
    await syncOk(first);
    const before = await rowsOf(calendarId);
    expect(JSON.parse((await tokenOf(calendarId))!)).toEqual({ etag: '"v1"', lastModified: 'Tue, 29 Sep 2026 10:00:00 GMT' });
    await asServiceRole().from('calendar_accounts').update({ last_error: 'Could not read the iPhone calendar (timed out).' }).eq('id', accountId);

    const later = Date.parse('2026-09-30T12:05:00Z');
    const summary = await syncOk({ ...first, now: () => later });

    expect(summary).toMatchObject({ accounts: 1, calendars: 1, events: 0, errors: [] });
    const sent = world.calls.at(-1)!.headers;
    expect(sent.get('If-None-Match')).toBe('"v1"');
    expect(sent.get('If-Modified-Since')).toBe('Tue, 29 Sep 2026 10:00:00 GMT');
    expect(await rowsOf(calendarId)).toEqual(before);
    expect(await accountOf(accountId)).toMatchObject({ status: 'active', last_error: null });
    expect(Date.parse((await accountOf(accountId)).last_synced_at!)).toBe(later);
  });

  it('reads the feed in full again once a day, so an unedited endless rule reaches the new window', async () => {
    const account = await arrange();
    const link = newLink();
    const { calendarId } = await arrangeIcloud(account, link);
    const weekly = vevent('weekly', 'Weekly', 'DTSTART:20261006T230000Z\nDTEND:20261007T000000Z\nRRULE:FREQ=WEEKLY');
    const world = fakeWorld(new Map<string, Reply>([[link, { text: feedOf(weekly), etag: '"v1"' }]]));
    const first = deps(account, world);
    await syncOk(first);
    const before = await rowsOf(calendarId);
    // Six months on from NOW ends before the 23:00Z occurrence of 2027-03-30.
    expect(before.map((row) => row.starts_at)).not.toContain('2027-03-30T23:00:00+00:00');

    // Within a day the feed is asked with its validator, answers 304, and nothing is read again.
    const HOUR = 3_600_000;
    await syncOk({ ...first, now: () => NOW + 23 * HOUR });
    expect(world.calls.at(-1)!.headers.get('If-None-Match')).toBe('"v1"');
    expect(await rowsOf(calendarId)).toEqual(before);

    // A day on it sends no validator, reads the feed in full, and the rows come from the new window.
    await syncOk({ ...first, now: () => NOW + 25 * HOUR });
    const sent = world.calls.at(-1)!.headers;
    expect(sent.get('If-None-Match')).toBeNull();
    expect(sent.get('If-Modified-Since')).toBeNull();
    const after = await rowsOf(calendarId);
    expect(after.map((row) => row.starts_at)).toContain('2027-03-30T23:00:00+00:00');
    expect(after).toHaveLength(before.length + 1);
    expect(JSON.parse((await tokenOf(calendarId))!)).toEqual({ etag: '"v1"', lastModified: null });

    // And the day's clock starts again from that read.
    await syncOk({ ...first, now: () => NOW + 26 * HOUR });
    expect(world.calls.at(-1)!.headers.get('If-None-Match')).toBe('"v1"');
  });

  it('reads the feed in full again when the calendar is reselected', async () => {
    const account = await arrange();
    const link = newLink();
    const { calendarId } = await arrangeIcloud(account, link);
    const world = fakeWorld(new Map<string, Reply>([[link, { text: feedOf(dentist), etag: '"v1"' }]]));
    await syncOk(deps(account, world));
    const admin = asServiceRole();
    await admin.from('mirrored_calendars').update({ selected: false }).eq('id', calendarId);
    expect(await rowsOf(calendarId)).toEqual([]);
    await syncOk(deps(account, world));
    expect(await rowsOf(calendarId)).toEqual([]);
    await admin.from('mirrored_calendars').update({ selected: true }).eq('id', calendarId);
    await syncOk(deps(account, world));
    expect(await rowsOf(calendarId)).toHaveLength(1);
  });
});

describe('when the feed says no', () => {
  it.each([401, 403, 404, 410])('marks the account needs_reauth on a %i and keeps its events', async (status) => {
    const account = await arrange();
    const link = newLink();
    const { accountId, calendarId } = await arrangeIcloud(account, link);
    const feeds = new Map<string, Reply>([[link, { text: feedOf(dentist), etag: '"v1"' }]]);
    const world = fakeWorld(feeds);
    await syncOk(deps(account, world));

    feeds.set(link, status);
    const summary = await syncOk(deps(account, world));

    expect(summary.errors).toHaveLength(1);
    expect(await accountOf(accountId)).toMatchObject({
      status: 'needs_reauth',
      last_error: 'This link no longer works. Turn on Public Calendar again and paste the new link.',
    });
    expect(await rowsOf(calendarId)).toHaveLength(1);

    // And it is left alone until the link is replaced.
    const calls = world.calls.length;
    await syncOk(deps(account, world));
    expect(world.calls).toHaveLength(calls);
  });

  it('records last_error for a broken or failing feed, retries it next run, and still syncs a Google account in the same run', async () => {
    const account = await arrange();
    const link = newLink();
    const broken = await arrangeIcloud(account, link);
    const google = await arrangeCalendar(account, { googleCalendarId: 'cal', refreshToken: 'refresh-A' });
    const feeds = new Map<string, Reply>([[link, { text: 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:cut\r\nDTSTART:20261014T140000Z\r\n' }]]);
    const world = fakeWorld(feeds, {
      cal: [{ id: 'standup', summary: 'Standup', start: { dateTime: '2026-10-05T09:00:00-05:00' }, end: { dateTime: '2026-10-05T09:30:00-05:00' } }],
    });

    const summary = await syncOk(deps(account, world));

    expect(summary.accounts).toBe(2);
    expect(summary.errors).toHaveLength(1);
    const state = await accountOf(broken.accountId);
    expect(state).toMatchObject({ status: 'active', last_synced_at: null });
    expect(state.last_error).toMatch(/^Could not read the iPhone calendar/);
    expect(state.last_error).not.toContain(link);
    expect(summary.errors[0]).not.toContain('secret-token');
    expect(await rowsOf(broken.calendarId)).toEqual([]);
    expect(await rowsOf(google.calendarId)).toHaveLength(1);
    expect(await accountOf(google.accountId)).toMatchObject({ status: 'active', last_error: null });

    // A server that cannot be reached, then a feed that works: the next run recovers.
    feeds.set(link, 'unreachable');
    const down = await syncOk(deps(account, world));
    expect(down.errors).toHaveLength(1);
    expect((await accountOf(broken.accountId)).last_error).not.toContain('secret-token');
    feeds.set(link, 500);
    await syncOk(deps(account, world));
    expect((await accountOf(broken.accountId)).last_error).toMatch(/500/);
    feeds.set(link, { text: feedOf(dentist), etag: '"v1"' });
    await syncOk(deps(account, world));
    expect(await rowsOf(broken.calendarId)).toHaveLength(1);
    expect(await accountOf(broken.accountId)).toMatchObject({ status: 'active', last_error: null });
  });

  it('never sends an iPhone calendar to Google, nor a Google account to a feed', async () => {
    const account = await arrange();
    const link = newLink();
    await arrangeIcloud(account, link);
    const world = fakeWorld(new Map<string, Reply>([[link, { text: feedOf() }]]));
    await syncOk(deps(account, world));
    expect(world.calls.map((call) => call.url)).toEqual([link]);
  });
});

describe('a run with more feed than it can read', () => {
  // A daily rule from the year 1700 reaches the window only after 119,000 steps: more than any cap.
  // A series with two rules is not skipped forward (see fastForwarded), so it is walked from DTSTART.
  const runaway = (uid: string, year = 1700) => vevent(uid, 'Runaway', `DTSTART:${year}0101T000000\nRRULE:FREQ=DAILY\nRRULE:FREQ=DAILY;INTERVAL=7`);
  // Four rules are more than a feed's steps (60,000 at 30,000 each), and fit the run only once.
  const heavy = (...extra: string[]) => feedOf(...extra, runaway('a'), runaway('b', 1701), runaway('c', 1702), runaway('d', 1703));
  const MINUTE = 60_000;

  async function arrangeFeeds(account: HouseholdAccount, count: number, text: string) {
    const feeds = new Map<string, Reply>();
    const calendars: { accountId: string; calendarId: string; link: string }[] = [];
    for (let index = 0; index < count; index += 1) {
      const link = newLink();
      feeds.set(link, { text });
      calendars.push({ ...(await arrangeIcloud(account, link)), link });
    }
    // Taken in the order the run takes accounts that have never been tried: by id.
    return { feeds, calendars: calendars.sort((a, b) => (a.accountId < b.accountId ? -1 : 1)) };
  }

  const stateOf = async (c: { accountId: string; calendarId: string }) => ({
    account: await accountOf(c.accountId),
    rows: (await rowsOf(c.calendarId)).map((row) => row.title),
    token: await tokenOf(c.calendarId),
  });
  const attemptedOf = async (accountId: string) => {
    const { data } = await asServiceRole().from('calendar_accounts').select('last_attempted_at').eq('id', accountId).single<{ last_attempted_at: string | null }>();
    return data!.last_attempted_at === null ? null : Date.parse(data!.last_attempted_at);
  };

  it('shares one step budget across the feeds: the first is read as far as its cap, the others are left as they were and say so', async () => {
    const account = await arrange();
    const { feeds, calendars } = await arrangeFeeds(account, 3, feedOf(dentist));
    for (const c of calendars) feeds.set(c.link, { text: feedOf(dentist), etag: '"v1"' });
    const world = fakeWorld(feeds);
    await syncOk(deps(account, world));
    const changed = vevent('changed', 'Changed', 'DTSTART:20261009T150000Z\nDTEND:20261009T160000Z');
    for (const c of calendars) feeds.set(c.link, { text: heavy(changed), etag: '"v2"' });

    const summary = await syncOk(deps(account, world));

    const states = await Promise.all(calendars.map(stateOf));
    const skipped = states.filter((state) => state.account.last_error === FEED_TOO_LARGE_MESSAGE);
    const read = states.filter((state) => state.account.last_error === FEED_TRUNCATED_MESSAGE);
    expect(read).toHaveLength(1);
    expect(skipped).toHaveLength(2);
    expect(summary.errors).toHaveLength(2);
    // A feed that was not read keeps its events and its validator, and stays active.
    for (const state of skipped) {
      expect(state.account.status).toBe('active');
      expect(state.rows).toEqual(['Dentist']);
      expect(JSON.parse(state.token!)).toEqual({ etag: '"v1"', lastModified: null });
    }
    expect(read[0]!.rows).toEqual(['Changed']);
    expect(JSON.parse(read[0]!.token!)).toEqual({ etag: '"v2"', lastModified: null, truncated: true });
  }, 60_000);

  it('goes to the feeds the run had no steps for first next time, and the one that used them goes last', async () => {
    const account = await arrange();
    const { feeds, calendars } = await arrangeFeeds(account, 3, heavy());
    const [p, q, r] = calendars as [(typeof calendars)[number], (typeof calendars)[number], (typeof calendars)[number]];
    const world = fakeWorld(feeds);
    const at = (run: number) => ({ ...deps(account, world), now: () => NOW + run * 5 * MINUTE });

    // Run 0: none has been tried, so by id. P takes the run's steps; Q takes what is left and is not
    // stored, so it has been tried; R found nothing left, was not really tried, and is as new as it was.
    await syncOk(at(0));
    expect((await accountOf(p.accountId)).last_error).toBe(FEED_TRUNCATED_MESSAGE);
    for (const c of [q, r]) expect((await accountOf(c.accountId)).last_error).toBe(FEED_TOO_LARGE_MESSAGE);
    expect(await attemptedOf(p.accountId)).toBe(NOW);
    expect(await attemptedOf(q.accountId)).toBe(NOW);
    expect(await attemptedOf(r.accountId)).toBeNull();
    // Nothing was read of Q or R: their last_synced_at is not moved.
    for (const c of [q, r]) expect((await accountOf(c.accountId)).last_synced_at).toBeNull();

    // Run 1: R, never tried, goes first.
    await syncOk(at(1));
    expect((await accountOf(r.accountId)).last_error).toBe(FEED_TRUNCATED_MESSAGE);
    expect((await accountOf(p.accountId)).last_error).toBe(FEED_TOO_LARGE_MESSAGE);
    expect(await attemptedOf(r.accountId)).toBe(NOW + 5 * MINUTE);
    expect(await attemptedOf(q.accountId)).toBe(NOW);

    // Run 2: Q, tried longest ago, goes first. P, the first of the two tried last, is last.
    await syncOk(at(2));
    expect((await accountOf(q.accountId)).last_error).toBe(FEED_TRUNCATED_MESSAGE);
  }, 120_000);

  it('does not start a feed the run has nothing left for, even a plain one: it is not fetched, and keeps its place in line', async () => {
    const account = await arrange();
    const { feeds, calendars } = await arrangeFeeds(account, 3, heavy());
    const plain = newLink();
    const last = await arrangeIcloud(account, plain);
    feeds.set(plain, { text: feedOf(dentist) });
    // The plain feed was tried last, so the heavy ones come first.
    for (const c of calendars) await asServiceRole().from('calendar_accounts').update({ last_attempted_at: new Date(NOW - 3_600_000).toISOString() }).eq('id', c.accountId);
    await asServiceRole().from('calendar_accounts').update({ last_attempted_at: new Date(NOW - 60_000).toISOString() }).eq('id', last.accountId);
    const world = fakeWorld(feeds);

    await syncOk(deps(account, world));

    expect(world.calls.map((call) => call.url)).not.toContain(plain);
    expect(await rowsOf(last.calendarId)).toEqual([]);
    expect(await accountOf(last.accountId)).toMatchObject({ status: 'active', last_error: FEED_TOO_LARGE_MESSAGE });
    expect(await attemptedOf(last.accountId)).toBe(NOW - 60_000);

    // The heavy feeds were tried: next time they are behind it, and it is read.
    await syncOk({ ...deps(account, world), now: () => NOW + 5 * MINUTE });
    expect((await rowsOf(last.calendarId)).map((row) => row.title)).toEqual(['Dentist']);
    expect(await accountOf(last.accountId)).toMatchObject({ status: 'active', last_error: null });
  }, 60_000);

  it('keeps a note a skipped feed already has, and says it was not read when it has none', async () => {
    const account = await arrange();
    const { feeds, calendars } = await arrangeFeeds(account, 3, feedOf(dentist, runaway('a')));
    const [, noted, bare] = calendars as [(typeof calendars)[number], (typeof calendars)[number], (typeof calendars)[number]];
    await asServiceRole().from('calendar_accounts').update({ last_error: FEED_TRUNCATED_MESSAGE }).eq('id', noted.accountId);
    let t = 0;

    // The first feed's walk is the run's whole time: the other two are skipped without being read.
    await syncOk({ ...deps(account, fakeWorld(feeds)), clock: () => (t += 1) });

    expect((await accountOf(noted.accountId)).last_error).toBe(FEED_TRUNCATED_MESSAGE);
    expect((await accountOf(bare.accountId)).last_error).toBe(FEED_TOO_LARGE_MESSAGE);
  }, 60_000);

  it('rotates a feed whose parse and added dates spend the run’s time, without walking a step, to the back, so the feeds behind it store their repeating series on the next runs', async () => {
    const account = await arrange();
    // The shape of a feed with a hundred thousand RDATEs, scaled down: its time is spent before and
    // apart from any step, so the run's steps are untouched when it fails.
    const dates = Array.from({ length: 200 }, (_, index) => `202610${String(1 + (index % 28)).padStart(2, '0')}T${String(index % 24).padStart(2, '0')}0000Z`).join(',');
    const rdates = vevent('rd', 'Dates', `DTSTART:20261001T000000Z
RDATE:${dates}`);
    const { feeds, calendars } = await arrangeFeeds(account, 3, feedOf(swim));
    const [heavyOne, p, q] = calendars as [(typeof calendars)[number], (typeof calendars)[number], (typeof calendars)[number]];
    feeds.set(heavyOne.link, { text: feedOf(rdates, swim) });
    const world = fakeWorld(feeds);
    // The clock jumps a second at every reading while the heavy feed is the one being read.
    let reading = '';
    let t = 0;
    const fetchHeavy = (async (input: string | URL | Request, init?: RequestInit) => {
      reading = String(input);
      return world.fetch(input, init);
    }) as typeof fetch;
    const at = (run: number) => ({ ...deps(account, world), fetch: fetchHeavy, now: () => NOW + run * 5 * MINUTE, clock: () => (reading === heavyOne.link ? (t += 1000) : t) });

    // Run 0: the heavy feed is first (by id), spends the run's time with no steps, and is not stored. The
    // others find the time gone: not fetched, not tried, nothing stored.
    await syncOk(at(0));
    expect((await accountOf(heavyOne.accountId)).last_error).toBe(FEED_TOO_LARGE_MESSAGE);
    expect(await attemptedOf(heavyOne.accountId)).toBe(NOW);
    for (const c of [p, q]) {
      expect((await accountOf(c.accountId)).last_error).toBe(FEED_TOO_LARGE_MESSAGE);
      expect(await attemptedOf(c.accountId)).toBeNull();
      expect(await rowsOf(c.calendarId)).toEqual([]);
    }

    // Run 1: the two never tried go first and store their repeating series; the heavy one is last.
    await syncOk(at(1));
    for (const c of [p, q]) {
      expect((await rowsOf(c.calendarId)).map((row) => row.title)).toEqual(['Swim', 'Swim', 'Swim']);
      expect(await accountOf(c.accountId)).toMatchObject({ status: 'active', last_error: null });
    }
    expect(await attemptedOf(heavyOne.accountId)).toBe(NOW + 5 * MINUTE);
    expect(world.calls.map((call) => call.url).slice(-3)).toEqual([p.link, q.link, heavyOne.link]);
  }, 120_000);

  it('stops reading feeds once the run has spent its 800 ms, as it does when it has no steps left', async () => {
    const account = await arrange();
    const { feeds, calendars } = await arrangeFeeds(account, 2, feedOf(dentist, runaway('a')));
    // A clock that moves a millisecond each time it is read: one feed's walk is the run's whole time.
    let t = 0;
    const world = fakeWorld(feeds);
    const summary = await syncOk({ ...deps(account, world), clock: () => (t += 1) });

    const [first, second] = await Promise.all(calendars.map(stateOf)) as [Awaited<ReturnType<typeof stateOf>>, Awaited<ReturnType<typeof stateOf>>];
    expect(first.account.last_error).toBe(FEED_TOO_LARGE_MESSAGE);
    expect(first.rows).toEqual([]);
    expect(second.account.last_error).toBe(FEED_TOO_LARGE_MESSAGE);
    expect(summary.errors).toHaveLength(2);
    // The first walked until the time was up, so it was tried; the second found no time left at all, and was not.
    expect(await attemptedOf(calendars[0]!.accountId)).toBe(NOW);
    expect(await attemptedOf(calendars[1]!.accountId)).toBeNull();
  }, 60_000);

  it('keeps a single event next to a runaway rule, stores what the rule reached, and says some repeating events were cut', async () => {
    const account = await arrange();
    for (const text of [feedOf(runaway('a'), dentist), feedOf(dentist, runaway('a')), feedOf(runaway('a'), dentist, runaway('b', 1701))]) {
      const link = newLink();
      const { accountId, calendarId } = await arrangeIcloud(account, link);
      const world = fakeWorld(new Map<string, Reply>([[link, { text, etag: '"v1"' }]]));

      await syncOk(deps(account, world));

      expect((await rowsOf(calendarId)).map((row) => row.title)).toEqual(['Dentist']);
      expect(await accountOf(accountId)).toMatchObject({ status: 'active', last_error: FEED_TRUNCATED_MESSAGE });
      expect(Date.parse((await accountOf(accountId)).last_synced_at!)).toBe(NOW);
      expect(JSON.parse((await tokenOf(calendarId))!)).toEqual({ etag: '"v1"', lastModified: null, truncated: true });
    }
  }, 60_000);

  it('does not expand a rule the iPhone cannot make, so a feed with one still syncs at once, keeping the rest and saying so', async () => {
    const account = await arrange();
    const link = newLink();
    const { accountId, calendarId } = await arrangeIcloud(account, link);
    const hostile = ['FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30', 'FREQ=SECONDLY;BYMONTH=1', 'FREQ=MINUTELY;BYMONTH=1'].map((rule, index) =>
      vevent(`h${index}`, 'Hostile', `DTSTART:20260201T000000Z\nRRULE:${rule}\nRDATE:20261010T150000Z`),
    );
    const world = fakeWorld(new Map<string, Reply>([[link, { text: feedOf(...hostile, dentist), etag: '"v1"' }]]));
    const began = Date.now();

    await syncOk({ ...deps(account, world), clock: () => performance.now() });

    expect(Date.now() - began).toBeLessThan(10_000);
    expect((await rowsOf(calendarId)).map((row) => row.title)).toEqual(['Dentist', 'Hostile', 'Hostile', 'Hostile']);
    expect(await accountOf(accountId)).toMatchObject({ status: 'active', last_error: FEED_TRUNCATED_MESSAGE });
  }, 60_000);

  it('clears the note when a later read of the feed is whole', async () => {
    const account = await arrange();
    const link = newLink();
    const { accountId } = await arrangeIcloud(account, link);
    const feeds = new Map<string, Reply>([[link, { text: feedOf(dentist, runaway('a')) }]]);
    const world = fakeWorld(feeds);
    await syncOk(deps(account, world));
    expect((await accountOf(accountId)).last_error).toBe(FEED_TRUNCATED_MESSAGE);

    feeds.set(link, { text: feedOf(dentist) });
    await syncOk(deps(account, world));
    expect((await accountOf(accountId)).last_error).toBeNull();
  }, 60_000);

  it('keeps the note on a 304, because what is stored is still what was cut, and drops it when a later read is whole', async () => {
    const account = await arrange();
    const link = newLink();
    const { accountId, calendarId } = await arrangeIcloud(account, link);
    const feeds = new Map<string, Reply>([[link, { text: feedOf(dentist, runaway('a')), etag: '"v1"' }]]);
    const world = fakeWorld(feeds);
    await syncOk(deps(account, world));
    expect((await accountOf(accountId)).last_error).toBe(FEED_TRUNCATED_MESSAGE);
    expect(JSON.parse((await tokenOf(calendarId))!)).toEqual({ etag: '"v1"', lastModified: null, truncated: true });

    const later = { ...deps(account, world), now: () => NOW + 5 * MINUTE };
    await syncOk(later);
    expect(world.calls.at(-1)!.headers.get('If-None-Match')).toBe('"v1"');
    expect(await accountOf(accountId)).toMatchObject({ status: 'active', last_error: FEED_TRUNCATED_MESSAGE });
    expect(Date.parse((await accountOf(accountId)).last_synced_at!)).toBe(NOW + 5 * MINUTE);
    expect((await rowsOf(calendarId)).map((row) => row.title)).toEqual(['Dentist']);

    feeds.set(link, { text: feedOf(dentist), etag: '"v2"' });
    await syncOk({ ...later, now: () => NOW + 10 * MINUTE });
    expect((await accountOf(accountId)).last_error).toBeNull();
    expect(JSON.parse((await tokenOf(calendarId))!)).toEqual({ etag: '"v2"', lastModified: null });

    // And a 304 after a whole read has no note to keep.
    await syncOk({ ...later, now: () => NOW + 15 * MINUTE });
    expect(world.calls.at(-1)!.headers.get('If-None-Match')).toBe('"v2"');
    expect((await accountOf(accountId)).last_error).toBeNull();
  }, 60_000);
});

describe('the order of a run', () => {
  it('syncs Google accounts before iPhone calendars, so a slow feed cannot keep Google waiting', async () => {
    const account = await arrange();
    const link = newLink();
    // The iPhone calendar is made first, so only the run's own ordering can put Google ahead of it.
    await arrangeIcloud(account, link);
    await arrangeCalendar(account, { googleCalendarId: 'cal', refreshToken: 'refresh-A' });
    const world = fakeWorld(new Map<string, Reply>([[link, { text: feedOf() }]]));

    await syncOk(deps(account, world));

    const urls = world.calls.map((call) => call.url);
    expect(urls.at(-1)).toBe(link);
    expect(urls.indexOf(GOOGLE_TOKEN_URL)).toBeLessThan(urls.indexOf(link));
    expect(urls.filter((url) => url === link)).toHaveLength(1);
  });

  it('takes the iPhone calendars by when they were last tried, never-tried first, then by id, whatever was last read', async () => {
    const account = await arrange();
    const made: { accountId: string; link: string }[] = [];
    const feeds = new Map<string, Reply>();
    for (let index = 0; index < 4; index += 1) {
      const link = newLink();
      feeds.set(link, { text: feedOf() });
      made.push({ ...(await arrangeIcloud(account, link)), link });
    }
    const [a, b, c, d] = made.sort((x, y) => (x.accountId < y.accountId ? -1 : 1)) as [(typeof made)[number], (typeof made)[number], (typeof made)[number], (typeof made)[number]];
    const admin = asServiceRole();
    const HOUR = 3_600_000;
    // C was tried longest ago but read a minute ago; D was tried more recently but read days ago.
    await admin.from('calendar_accounts').update({ last_attempted_at: new Date(NOW - 3 * HOUR).toISOString(), last_synced_at: new Date(NOW - 60_000).toISOString() }).eq('id', c.accountId);
    await admin.from('calendar_accounts').update({ last_attempted_at: new Date(NOW - HOUR).toISOString(), last_synced_at: new Date(NOW - 72 * HOUR).toISOString() }).eq('id', d.accountId);
    const world = fakeWorld(feeds);

    await syncOk(deps(account, world));

    // A and B were never tried: by id. Then C, then D.
    expect(world.calls.map((call) => call.url)).toEqual([a.link, b.link, c.link, d.link]);
  });

  it('writes when an iPhone calendar was tried before it asks the feed, and never for a Google account', async () => {
    const account = await arrange();
    const link = newLink();
    const { accountId } = await arrangeIcloud(account, link);
    const google = await arrangeCalendar(account, { googleCalendarId: 'cal', refreshToken: 'refresh-A' });
    const world = fakeWorld(new Map<string, Reply>([[link, { text: feedOf(dentist) }]]));
    const seen: (string | null)[] = [];
    const spy = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === link) {
        const { data } = await asServiceRole().from('calendar_accounts').select('last_attempted_at').eq('id', accountId).single<{ last_attempted_at: string | null }>();
        seen.push(data!.last_attempted_at);
      }
      return world.fetch(input, init);
    }) as typeof fetch;

    await syncOk(deps(account, { fetch: spy }));

    expect(seen).toHaveLength(1);
    expect(Date.parse(seen[0]!)).toBe(NOW);
    const { data } = await asServiceRole().from('calendar_accounts').select('last_attempted_at').eq('id', google.accountId).single<{ last_attempted_at: string | null }>();
    expect(data!.last_attempted_at).toBeNull();
  });

  it('keeps last_attempted_at out of a client’s reach', async () => {
    const account = await arrange();
    await arrangeIcloud(account, newLink());
    const phone = await asHouseholdAccount(account);
    const { error } = await phone.from('calendar_accounts').select('last_attempted_at');
    expect(error).not.toBeNull();
  });
});
