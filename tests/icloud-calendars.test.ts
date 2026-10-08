import { FunctionsHttpError } from '@supabase/supabase-js';
import { afterEach, describe, expect, it } from 'vitest';
import { handleCalendarConnect, type ConnectDeps } from '../supabase/functions/calendar-connect/handler';
import { AddRefused, IPHONE_ADDED, IPHONE_ADD_FAILED, addIphoneCalendar, calendarsOfAccount, loadCalendarAccounts, loadMirroredCalendars, removeCalendarAccount, sendLink, updateMirroredCalendar } from '../src/lib/calendar-accounts';
import { PROFILE_PALETTE, createProfile } from '../src/lib/profiles';
import { arrangeEvents } from './support/calendar';
import {
  asAnonymous,
  asDevice,
  asHouseholdAccount,
  asServiceRole,
  asTablet,
  createHousehold,
  createSignedUpAccount,
  destroyHousehold,
  destroySignedUpAccount,
  destroyTablet,
  signInAs,
  type SignedUpAccount,
  type HouseholdAccount,
  type Tablet,
} from './support/supabase';

const functionUrl = 'https://nidus.test/functions/v1/calendar-connect';
const env = {
  functionUrl,
  appUrl: 'https://nidus.test/',
  stateSecret: 'test-state-secret-that-is-long-enough-to-sign-with',
  googleClientId: 'client-id',
  googleClientSecret: 'client-secret',
};

const LINK = 'https://p12-caldav.icloud.com/published/2/secret-feed-token-1';
const WEBCAL = 'webcal://p12-caldav.icloud.com/published/2/secret-feed-token-1';
const feedText = (name?: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${name ? `X-WR-CALNAME:${name}\r\n` : ''}END:VCALENDAR\r\n`;

// The feed's server is the only fake. It answers one link, or nothing it knows.
function fakeFeed(reply: Response | (() => Response)) {
  const calls: string[] = [];
  const fake = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return String(input) === LINK ? (typeof reply === 'function' ? reply() : reply.clone()) : new Response('missing', { status: 404 });
  }) as typeof fetch;
  return { fetch: fake, calls };
}

function deps(feed: { fetch: typeof fetch }): ConnectDeps {
  return { env, admin: asServiceRole(), fetch: feed.fetch };
}

async function tokenOf(client: { auth: { getSession(): Promise<{ data: { session: { access_token: string } | null } }> } }): Promise<string> {
  return (await client.auth.getSession()).data.session!.access_token;
}

async function post(d: ConnectDeps, body: unknown, token?: string): Promise<Response> {
  return handleCalendarConnect(
    new Request(`${functionUrl}/icloud`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    }),
    d,
  );
}

let households: HouseholdAccount[] = [];
let tablets: Tablet[] = [];
let newcomers: SignedUpAccount[] = [];

async function arrange(): Promise<HouseholdAccount> {
  const account = await createHousehold();
  households.push(account);
  return account;
}

async function addLink(account: HouseholdAccount, link: string, feed: ReturnType<typeof fakeFeed>): Promise<Response> {
  return post(deps(feed), { url: link }, await tokenOf(await asHouseholdAccount(account)));
}

async function accountRows(account: HouseholdAccount) {
  const { data } = await asServiceRole()
    .from('calendar_accounts')
    .select('id, provider, google_email, status, vault_secret_id, feed_key')
    .eq('household_id', account.household.id);
  return data ?? [];
}

afterEach(async () => {
  await Promise.all(tablets.map((tablet) => destroyTablet(tablet)));
  await Promise.all(newcomers.map(destroySignedUpAccount));
  newcomers = [];
  await Promise.all(households.map((account) => destroyHousehold(account)));
  tablets = [];
  households = [];
});

describe('POST /icloud', () => {
  it('stores an iCloud account and its one selected Mirrored Calendar, named from the feed, with the link in Vault', async () => {
    const account = await arrange();
    const feed = fakeFeed(new Response(feedText('Family'), { headers: { ETag: '"v1"' } }));

    const response = await addLink(account, WEBCAL, feed);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: string; name: string };
    expect(body.name).toBe('Family');
    // Fetched once, over https: webcal is only a spelling.
    expect(feed.calls).toEqual([LINK]);

    const [row] = await accountRows(account);
    expect(await accountRows(account)).toHaveLength(1);
    expect(row).toMatchObject({ id: body.id, provider: 'icloud', google_email: null, status: 'active' });
    expect(row!.feed_key).toMatch(/^[0-9a-f]{64}$/);
    const admin = asServiceRole();
    expect((await admin.rpc('read_calendar_secret', { p_secret_id: row!.vault_secret_id })).data).toBe(LINK);

    const phone = await asHouseholdAccount(account);
    expect(await loadMirroredCalendars(phone)).toEqual([
      expect.objectContaining({
        calendar_account_id: body.id,
        google_calendar_id: 'ics',
        name: 'Family',
        selected: true,
        profile_id: null,
        color: null,
      }),
    ]);
    expect((await loadCalendarAccounts(phone))[0]).toMatchObject({ id: body.id, provider: 'icloud', google_email: null });
  });

  it('calls a calendar with no name "iPhone calendar"', async () => {
    const account = await arrange();
    const response = await addLink(account, LINK, fakeFeed(new Response(feedText())));
    expect(((await response.json()) as { name: string }).name).toBe('iPhone calendar');
    expect((await loadMirroredCalendars(await asHouseholdAccount(account)))[0]!.name).toBe('iPhone calendar');
  });

  it('refuses a link that is not an iPhone calendar link, in words, and fetches nothing', async () => {
    const account = await arrange();
    const feed = fakeFeed(new Response(feedText()));
    const tooLong = `https://p12-caldav.icloud.com/published/2/${'a'.repeat(2048)}`;
    for (const url of ['https://example.com/feed.ics', 'http://p12-caldav.icloud.com/x', 'https://10.0.0.1/x', '', 42, null, tooLong]) {
      const response = await addLink(account, url as string, feed);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'That is not an iPhone calendar link.' });
    }
    expect((await post(deps(feed), {}, await tokenOf(await asHouseholdAccount(account)))).status).toBe(400);
    expect(feed.calls).toEqual([]);
    expect(await accountRows(account)).toEqual([]);
  });

  it('says it could not read the calendar when the feed is gone, broken or not a calendar, and stores nothing', async () => {
    const account = await arrange();
    const words = { error: 'Could not read that calendar. Check the link and that Public Calendar is on.' };
    for (const reply of [new Response('no', { status: 404 }), new Response('boom', { status: 500 }), new Response('<html></html>')]) {
      const response = await addLink(account, LINK, fakeFeed(reply));
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual(words);
    }
    expect(await accountRows(account)).toEqual([]);
  });

  it('refuses the same link again, however it is spelled, and says so in words', async () => {
    const account = await arrange();
    expect((await addLink(account, LINK, fakeFeed(new Response(feedText('Family'))))).status).toBe(200);
    for (const spelling of [LINK, WEBCAL, '  WEBCAL://P12-CalDAV.iCloud.com/published/2/secret-feed-token-1 ']) {
      const response = await addLink(account, spelling, fakeFeed(new Response(feedText('Family'))));
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: 'That calendar is already on the Wall.' });
    }
    expect(await accountRows(account)).toHaveLength(1);
    expect(await loadMirroredCalendars(await asHouseholdAccount(account))).toHaveLength(1);
  });

  it('refuses the same link with a query, a fragment or an escape, which are the same link', async () => {
    const account = await arrange();
    expect((await addLink(account, LINK, fakeFeed(new Response(feedText('Family'))))).status).toBe(200);
    for (const spelling of [`${LINK}?`, `${LINK}?x=1`, `${LINK}#top`, LINK.replace('secret-feed', '%73ecret-feed')]) {
      expect((await addLink(account, spelling, fakeFeed(new Response(feedText('Family'))))).status, spelling).toBe(409);
    }
    expect(await accountRows(account)).toHaveLength(1);
  });

  it('lets one of two adds of the same link at the same moment in, and refuses the other', async () => {
    const account = await arrange();
    const token = await tokenOf(await asHouseholdAccount(account));
    const add = () => post(deps(fakeFeed(new Response(feedText('Family')))), { url: LINK }, token);
    const statuses = (await Promise.all([add(), add()])).map((response) => response.status).sort();
    expect(statuses).toEqual([200, 409]);
    expect(await accountRows(account)).toHaveLength(1);
    expect(await loadMirroredCalendars(await asHouseholdAccount(account))).toHaveLength(1);
  });

  it('lets another Household add the same link', async () => {
    const [first, second] = [await arrange(), await arrange()];
    expect((await addLink(first, LINK, fakeFeed(new Response(feedText())))).status).toBe(200);
    expect((await addLink(second, LINK, fakeFeed(new Response(feedText())))).status).toBe(200);
  });

  it('lets a second Household Account, joined through an invite, add a link for the Household', async () => {
    const account = await arrange();
    const { data: invite } = await (await asHouseholdAccount(account)).rpc('create_household_invite').single<{ token: string }>();
    const arranged = await createSignedUpAccount();
    newcomers.push(arranged);
    const phone = await signInAs(arranged);
    expect((await phone.rpc('accept_household_invite', { p_token: invite!.token })).error).toBeNull();

    const response = await post(deps(fakeFeed(new Response(feedText('Family')))), { url: LINK }, await tokenOf(phone));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: string; name: string };
    expect(body.name).toBe('Family');
    // The calendar belongs to the Household: the first account sees it too.
    expect(await accountRows(account)).toHaveLength(1);
    expect(await loadMirroredCalendars(await asHouseholdAccount(account))).toEqual([expect.objectContaining({ calendar_account_id: body.id, name: 'Family' })]);
  });

  it('refuses a request with no session, a Device and an anonymous tablet, and fetches nothing', async () => {
    const account = await arrange();
    const feed = fakeFeed(new Response(feedText()));
    const d = deps(feed);

    expect((await post(d, { url: LINK })).status).toBe(401);
    expect((await post(d, { url: LINK }, 'not-a-jwt')).status).toBe(401);

    const device = await asDevice(account);
    tablets.push(device);
    expect((await post(d, { url: LINK }, await tokenOf(device.client))).status).toBe(403);

    const anonymous = await asTablet();
    tablets.push(anonymous);
    expect((await post(d, { url: LINK }, await tokenOf(anonymous.client))).status).toBe(403);

    expect(feed.calls).toEqual([]);
    expect(await accountRows(account)).toEqual([]);
  });
});

describe('what no client can read', () => {
  it('keeps the link, feed_key and Vault secret from the Household Account, a Device and anonymous', async () => {
    const account = await arrange();
    await addLink(account, LINK, fakeFeed(new Response(feedText('Family'))));
    const [row] = await accountRows(account);
    const device = await asDevice(account);
    tablets.push(device);

    for (const client of [await asHouseholdAccount(account), device.client, asAnonymous()]) {
      for (const column of ['feed_key', 'vault_secret_id', '*']) {
        const { data, error } = await client.from('calendar_accounts').select(column);
        expect(error, column).not.toBeNull();
        expect(data).toBeNull();
      }
      const { data: allowed } = await client.from('calendar_accounts').select('id, provider, google_email, status, last_synced_at, last_error, created_at');
      const shown = JSON.stringify(allowed);
      for (const secret of [LINK, 'secret-feed-token-1', row!.feed_key, row!.vault_secret_id]) expect(shown).not.toContain(secret);

      const calendars = await client.from('mirrored_calendars').select('id, name, google_calendar_id');
      expect(JSON.stringify(calendars.data)).not.toContain('secret-feed-token-1');
      expect((await client.from('mirrored_calendars').select('sync_token')).error).not.toBeNull();

      expect((await client.from('calendar_accounts').update({ feed_key: 'x', provider: 'google' }).eq('id', row!.id)).error).not.toBeNull();
      expect((await client.rpc('store_icloud_calendar', { p_household_id: account.household.id, p_link: LINK, p_name: 'x' })).error).not.toBeNull();
      expect((await client.rpc('read_calendar_secret', { p_secret_id: row!.vault_secret_id })).error).not.toBeNull();
    }
  });

  it('shows the Household Account and a Device the provider, and a Device still reads accounts, calendars and events', async () => {
    const account = await arrange();
    await addLink(account, LINK, fakeFeed(new Response(feedText('Family'))));
    const [row] = await accountRows(account);
    const device = await asDevice(account);
    tablets.push(device);
    expect(await loadCalendarAccounts(device.client)).toEqual([expect.objectContaining({ id: row!.id, provider: 'icloud' })]);
    expect(await loadMirroredCalendars(device.client)).toHaveLength(1);
  });
});

describe('the provider rule', () => {
  it('makes an existing or new Google account google, and refuses an identity that does not fit its provider', async () => {
    const account = await arrange();
    const admin = asServiceRole();
    const { data: id } = await admin.rpc('store_calendar_account', {
      p_household_id: account.household.id,
      p_google_email: 'parent@example.com',
      p_refresh_token: 'r',
    });
    const [google] = await accountRows(account);
    expect(google).toMatchObject({ id, provider: 'google', google_email: 'parent@example.com', feed_key: null });

    expect((await admin.rpc('read_calendar_secret', { p_secret_id: google!.vault_secret_id })).data).toBe('r');
    const base = { household_id: account.household.id, vault_secret_id: google!.vault_secret_id };
    expect((await admin.from('calendar_accounts').insert({ ...base, provider: 'icloud', google_email: 'a@example.com' })).error).not.toBeNull();
    expect((await admin.from('calendar_accounts').insert({ ...base, provider: 'google', google_email: null })).error).not.toBeNull();
    expect((await admin.from('calendar_accounts').insert({ ...base, provider: 'outlook', google_email: null })).error).not.toBeNull();
  });
});

describe('removing an iPhone calendar', () => {
  it('removes its Vault secret, its Mirrored Calendar and its Synced Events', async () => {
    const account = await arrange();
    const response = await addLink(account, LINK, fakeFeed(new Response(feedText('Family'))));
    const { id } = (await response.json()) as { id: string };
    const phone = await asHouseholdAccount(account);
    const [calendar] = await loadMirroredCalendars(phone);
    await arrangeEvents(calendar!.id, [
      { google_event_id: 'uid-1|2026-10-07T15:00:00Z', title: 'Dentist', starts_at: '2026-10-07T15:00:00Z', ends_at: '2026-10-07T16:00:00Z' },
    ]);
    const admin = asServiceRole();
    const [row] = await accountRows(account);

    const { error } = await phone.from('calendar_accounts').delete().eq('id', id);
    expect(error).toBeNull();

    expect((await admin.rpc('calendar_secret_exists', { p_secret_id: row!.vault_secret_id })).data).toBe(false);
    expect((await admin.from('mirrored_calendars').select('id').eq('id', calendar!.id)).data).toEqual([]);
    expect((await admin.from('synced_events').select('id').eq('mirrored_calendar_id', calendar!.id)).data).toEqual([]);
    // The link can be added again once it has been removed.
    expect((await addLink(account, LINK, fakeFeed(new Response(feedText('Family'))))).status).toBe(200);
  });
});

describe('addIphoneCalendar', () => {
  const client = (result: unknown) => ({ functions: { invoke: async () => result } }) as unknown as Parameters<typeof addIphoneCalendar>[0];

  it('calls the route and resolves when the calendar is added', async () => {
    const calls: unknown[] = [];
    const spy = { functions: { invoke: async (...args: unknown[]) => (calls.push(args), { data: { id: 'a', name: 'Family' }, error: null }) } };
    await addIphoneCalendar(spy as unknown as Parameters<typeof addIphoneCalendar>[0], LINK);
    expect(calls).toEqual([['calendar-connect/icloud', { body: { url: LINK } }]]);
  });

  const refused = (status: number, error: string) => client({ data: null, error: new FunctionsHttpError(Response.json({ error }, { status })) });

  it('throws the route’s own words when it refuses a link (400), has it already (409) or could not read it (502)', async () => {
    for (const [status, words] of [
      [400, 'That is not an iPhone calendar link.'],
      [409, 'That calendar is already on the Wall.'],
      [502, 'Could not read that calendar. Check the link and that Public Calendar is on.'],
    ] as const) {
      const thrown = await addIphoneCalendar(refused(status, words), LINK).catch((error: unknown) => error);
      expect(thrown).toBeInstanceOf(AddRefused);
      expect((thrown as Error).message).toBe(words);
    }
  });

  it('says the plain fallback for any other answer, whatever words the route sent', async () => {
    for (const [status, words] of [
      [401, 'Sign in first.'],
      [403, 'Only the Household Account can add a Mirrored Calendar.'],
      [500, 'Calendar Account insert failed: duplicate key'],
      [404, 'Not found.'],
    ] as const) {
      const thrown = await addIphoneCalendar(refused(status, words), LINK).catch((error: unknown) => error);
      expect(thrown).toBeInstanceOf(AddRefused);
      expect((thrown as Error).message).toBe(IPHONE_ADD_FAILED);
    }
    const noWords = client({ data: null, error: new FunctionsHttpError(new Response('<html>', { status: 400 })) });
    await expect(addIphoneCalendar(noWords, LINK)).rejects.toThrow(IPHONE_ADD_FAILED);
  });

  it('throws what supabase-js threw when the request got no answer, for the page to word as it words any write', async () => {
    const offline = new TypeError('Failed to fetch');
    const thrown = await addIphoneCalendar(client({ data: null, error: offline }), LINK).catch((error: unknown) => error);
    expect(thrown).toBe(offline);
    expect(thrown).not.toBeInstanceOf(AddRefused);
  });
});

describe('what an Add comes to', () => {
  const press = (add: (url: string) => Promise<void>, over: { link?: string; current?: () => string } = {}) =>
    sendLink({ link: over.link ?? `  ${LINK} `, current: over.current ?? (() => LINK), add });

  it('sends the link trimmed, clears the field, and says what the status line says', async () => {
    const sent: string[] = [];
    expect(await press(async (url) => void sent.push(url))).toEqual({ kind: 'added', clear: true, say: 'Added. First sync within 5 minutes.' });
    expect(IPHONE_ADDED).toBe('Added. First sync within 5 minutes.');
    expect(sent).toEqual([LINK]);
  });

  it('keeps what was typed while it was adding: the field clears only if it still holds the link that was sent', async () => {
    expect(await press(async () => undefined, { current: () => `${LINK}2` })).toMatchObject({ kind: 'added', clear: false });
    expect(await press(async () => undefined, { current: () => '' })).toMatchObject({ kind: 'added', clear: false });
    // Spaces around the same link are the same link.
    expect(await press(async () => undefined, { current: () => ` ${LINK}` })).toMatchObject({ kind: 'added', clear: true });
  });

  it('lets the route’s words reach the field, and leaves the field alone', async () => {
    const result = await press(async () => Promise.reject(new AddRefused('That calendar is already on the Wall.')));
    expect(result).toEqual({ kind: 'refused', words: 'That calendar is already on the Wall.' });
  });

  it('hands any other failure back for the page to word', async () => {
    const offline = new TypeError('Failed to fetch');
    expect(await press(async () => Promise.reject(offline))).toEqual({ kind: 'failed', error: offline });
  });
});

// What the Settings page does with them (CalendarAccountsSection): the page lists what the Household Account's client reads, sets
// whose an iPhone calendar is, and removes it, through the same functions the page calls.
describe('the Settings page’s code path', () => {
  it('lists an added link as an iPhone calendar with its name, then lets the owner say whose it is, and remove it', async () => {
    const account = await arrange();
    expect((await addLink(account, WEBCAL, fakeFeed(new Response(feedText('Sam’s iPhone'))))).status).toBe(200);
    const phone = await asHouseholdAccount(account);

    const [listed] = await loadCalendarAccounts(phone);
    expect(listed).toMatchObject({ provider: 'icloud', google_email: null, status: 'active', last_synced_at: null, last_error: null, truncated: false });
    const [calendar] = calendarsOfAccount(await loadMirroredCalendars(phone), listed!.id);
    expect(calendar).toMatchObject({ name: 'Sam’s iPhone', selected: true, profile_id: null });

    const sam = await createProfile(phone, account.household.id, { name: 'Sam', color: PROFILE_PALETTE[1].hex, avatar_url: null }, 0);
    await updateMirroredCalendar(phone, calendar!.id, { profile_id: sam.id });
    expect((await loadMirroredCalendars(phone))[0]).toMatchObject({ id: calendar!.id, profile_id: sam.id, selected: true });
    await updateMirroredCalendar(phone, calendar!.id, { profile_id: null });
    expect((await loadMirroredCalendars(phone))[0]).toMatchObject({ profile_id: null });

    await removeCalendarAccount(phone, listed!.id);
    expect(await loadCalendarAccounts(phone)).toEqual([]);
    expect(await loadMirroredCalendars(phone)).toEqual([]);
  });

  it('lists an iPhone calendar and a Google account side by side, each with its own provider', async () => {
    const account = await arrange();
    await asServiceRole().rpc('store_calendar_account', { p_household_id: account.household.id, p_google_email: 'parent@example.com', p_refresh_token: 'r' });
    await addLink(account, LINK, fakeFeed(new Response(feedText())));
    const listed = await loadCalendarAccounts(await asHouseholdAccount(account));
    expect(listed.map(({ provider }) => provider).sort()).toEqual(['google', 'icloud']);
  });
});
