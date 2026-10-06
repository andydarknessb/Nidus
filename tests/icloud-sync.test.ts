import { afterEach, describe, expect, it } from 'vitest';
import { FEED_TOO_LARGE_MESSAGE, GOOGLE_TOKEN_URL, handleCalendarSync, type SyncDeps, type SyncSummary } from '../supabase/functions/calendar-sync/handler';
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
  const runaway = (uid: string) => vevent(uid, 'Runaway', 'DTSTART:19700101T000000\nRRULE:FREQ=SECONDLY');

  it('shares one step budget across the feeds: two bad feeds are read as far as their caps, the third is left as it was and says so', async () => {
    const account = await arrange();
    const feeds = new Map<string, Reply>();
    const calendars: { accountId: string; calendarId: string; link: string }[] = [];
    for (let index = 0; index < 3; index += 1) {
      const link = newLink();
      feeds.set(link, { text: feedOf(dentist), etag: '"v1"' });
      calendars.push({ ...(await arrangeIcloud(account, link)), link });
    }
    const world = fakeWorld(feeds);
    await syncOk(deps(account, world));
    const changed = vevent('changed', 'Changed', 'DTSTART:20261009T150000Z\nDTEND:20261009T160000Z');
    for (const { link } of calendars) feeds.set(link, { text: feedOf(changed, runaway('a')), etag: '"v2"' });

    const summary = await syncOk(deps(account, world));

    const states = await Promise.all(
      calendars.map(async (c) => ({ account: await accountOf(c.accountId), rows: await rowsOf(c.calendarId), token: await tokenOf(c.calendarId) })),
    );
    const skipped = states.filter((state) => state.account.last_error === FEED_TOO_LARGE_MESSAGE);
    const read = states.filter((state) => state.account.last_error === null);
    expect(skipped).toHaveLength(1);
    expect(read).toHaveLength(2);
    expect(summary.errors).toHaveLength(1);
    // The feed that was not read keeps its events and its validator, and stays active.
    expect(skipped[0]!.account.status).toBe('active');
    expect(skipped[0]!.rows.map((row) => row.title)).toEqual(['Dentist']);
    expect(JSON.parse(skipped[0]!.token!)).toEqual({ etag: '"v1"', lastModified: null });
    // The others keep what they reached of theirs.
    for (const state of read) expect(state.rows.map((row) => row.title)).toEqual(['Changed']);
  }, 60_000);

  it('stops one feed at its own cap and keeps the events it reached, with no error', async () => {
    const account = await arrange();
    const link = newLink();
    const { accountId, calendarId } = await arrangeIcloud(account, link);
    const world = fakeWorld(new Map<string, Reply>([[link, { text: feedOf(dentist, runaway('a'), runaway('b')), etag: '"v1"' }]]));

    await syncOk(deps(account, world));

    expect((await rowsOf(calendarId)).map((row) => row.title)).toEqual(['Dentist']);
    expect(await accountOf(accountId)).toMatchObject({ status: 'active', last_error: null });
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
});
