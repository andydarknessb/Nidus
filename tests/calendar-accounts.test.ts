import { afterEach, describe, expect, it } from 'vitest';
import {
  CALENDAR_SCOPE,
  GOOGLE_CALENDAR_LIST_URL,
  GOOGLE_TOKEN_URL,
  LINK_STATE_SECONDS,
  SETTINGS_STATE_SECONDS,
  handleCalendarConnect,
  signState,
  verifyState,
  type ConnectDeps,
} from '../supabase/functions/calendar-connect/handler';
import {
  calendarsOfAccount,
  loadCalendarAccounts,
  loadMirroredCalendars,
  removeCalendarAccount,
  updateMirroredCalendar,
  type MirroredCalendar,
} from '../src/lib/calendar-accounts';
import { PROFILE_PALETTE, createProfile } from '../src/lib/profiles';
import {
  asDevice,
  asHouseholdAccount,
  asServiceRole,
  createHousehold,
  destroyHousehold,
  destroyTablet,
  type HouseholdAccount,
  type Tablet,
} from './support/supabase';

const STATE_SECRET = 'test-state-secret-that-is-long-enough-to-sign-with';
const env = {
  functionUrl: 'https://nidus.test/functions/v1/calendar-connect',
  appUrl: 'https://nidus.test/',
  stateSecret: STATE_SECRET,
  googleClientId: 'client-id.apps.googleusercontent.com',
  googleClientSecret: 'client-secret',
};

// Google's HTTP API is the only fake: canned token and calendarList responses.
type FakeGoogle = { fetch: typeof fetch; calls: { url: string; init?: RequestInit }[] };

function fakeGoogle(options: {
  email: string;
  refreshToken?: string | null;
  calendars?: { id: string; summary: string; primary?: boolean }[];
  tokenStatus?: number;
}): FakeGoogle {
  const calls: FakeGoogle['calls'] = [];
  const calendars = options.calendars ?? [
    { id: options.email, summary: options.email, primary: true },
    { id: 'family@group.calendar.google.com', summary: 'Family' },
    { id: 'school@group.calendar.google.com', summary: 'School' },
  ];
  const fake = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push(init ? { url, init } : { url });
    if (url === GOOGLE_TOKEN_URL) {
      if (options.tokenStatus && options.tokenStatus !== 200) return Promise.resolve(new Response('{}', { status: options.tokenStatus }));
      const body: Record<string, string> = { access_token: 'access-token' };
      if (options.refreshToken !== null) body['refresh_token'] = options.refreshToken ?? 'refresh-token-1';
      return Promise.resolve(Response.json(body));
    }
    if (url.startsWith(GOOGLE_CALENDAR_LIST_URL)) return Promise.resolve(Response.json({ items: calendars }));
    return Promise.resolve(new Response('unexpected', { status: 500 }));
  };
  return { fetch: fake as typeof fetch, calls };
}

function deps(google: FakeGoogle, extra: Partial<ConnectDeps> = {}): ConnectDeps {
  return { env, admin: asServiceRole(), fetch: google.fetch, ...extra };
}

async function jwtOf(account: HouseholdAccount): Promise<string> {
  const client = await asHouseholdAccount(account);
  const { data } = await client.auth.getSession();
  return data.session!.access_token;
}

async function startFlow(account: HouseholdAccount, kind: 'settings' | 'link', d: ConnectDeps): Promise<string> {
  const response = await handleCalendarConnect(
    new Request(`${env.functionUrl}/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await jwtOf(account)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind }),
    }),
    d,
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { url: string }).url;
}

// What Google does: send the browser back to our redirect_uri with a code and the state it was given.
function callbackFor(state: string, extra: Record<string, string> = { code: 'auth-code' }): Request {
  const url = new URL(`${env.functionUrl}/callback`);
  url.searchParams.set('state', state);
  for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
  return new Request(url);
}

function stateOf(consentUrl: string): string {
  return new URL(consentUrl).searchParams.get('state')!;
}

let households: HouseholdAccount[] = [];
let tablets: Tablet[] = [];

async function arrange(): Promise<HouseholdAccount> {
  const account = await createHousehold();
  households.push(account);
  return account;
}

async function connect(account: HouseholdAccount, email: string, refreshToken = 'refresh-token-1'): Promise<string> {
  const google = fakeGoogle({ email, refreshToken });
  const d = deps(google);
  const state = stateOf(await startFlow(account, 'settings', d));
  const response = await handleCalendarConnect(callbackFor(state), d);
  expect(response.status).toBe(302);
  const { data } = await asServiceRole()
    .from('calendar_accounts')
    .select('id')
    .eq('household_id', account.household.id)
    .eq('google_email', email)
    .single<{ id: string }>();
  return data!.id;
}

afterEach(async () => {
  await Promise.all(tablets.map((tablet) => destroyTablet(tablet)));
  await Promise.all(households.map((account) => destroyHousehold(account)));
  tablets = [];
  households = [];
});

describe('the signed state parameter', () => {
  it('round-trips a Household and refuses tampering, a wrong secret, and expiry', async () => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    const token = await signState(STATE_SECRET, { household_id: 'h1', kind: 'settings', exp });
    expect(await verifyState(STATE_SECRET, token, Date.now())).toEqual({ household_id: 'h1', kind: 'settings', exp });

    const forged = await signState(STATE_SECRET, { household_id: 'h2', kind: 'settings', exp });
    const swapped = `${forged.split('.')[0]}.${token.split('.')[1]}`;
    expect(await verifyState(STATE_SECRET, swapped, Date.now())).toBeNull();
    expect(await verifyState('another-secret-entirely-1234567890', token, Date.now())).toBeNull();
    expect(await verifyState(STATE_SECRET, token, (exp + 1) * 1000)).toBeNull();
    expect(await verifyState(STATE_SECRET, 'not-a-token', Date.now())).toBeNull();
    expect(await verifyState(STATE_SECRET, null, Date.now())).toBeNull();
  });
});

describe('calendar-connect start', () => {
  it('gives a Household Account Google’s consent URL, offline, read-only, bound to its Household', async () => {
    const account = await arrange();
    const url = new URL(await startFlow(account, 'settings', deps(fakeGoogle({ email: 'a@example.com' }))));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('scope')).toBe(CALENDAR_SCOPE);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('redirect_uri')).toBe(`${env.functionUrl}/callback`);
    const state = await verifyState(STATE_SECRET, url.searchParams.get('state'), Date.now());
    expect(state?.household_id).toBe(account.household.id);
    expect(state!.exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(SETTINGS_STATE_SECONDS);
  });

  it('refuses a request with no session, a Device, and an anonymous tablet', async () => {
    const account = await arrange();
    const d = deps(fakeGoogle({ email: 'a@example.com' }));
    const post = (headers: Record<string, string>) =>
      handleCalendarConnect(new Request(`${env.functionUrl}/start`, { method: 'POST', headers, body: '{}' }), d);

    expect((await post({})).status).toBe(401);
    expect((await post({ Authorization: 'Bearer not-a-jwt' })).status).toBe(401);

    const device = await asDevice(account);
    tablets.push(device);
    const { data } = await device.client.auth.getSession();
    expect((await post({ Authorization: `Bearer ${data.session!.access_token}` })).status).toBe(403);
  });
});

describe('calendar-connect callback', () => {
  it('exchanges the code, stores the refresh token in Vault, upserts the account and lists the calendars unselected', async () => {
    const account = await arrange();
    const google = fakeGoogle({ email: 'Parent@Example.com'.toLowerCase(), refreshToken: 'the-refresh-token' });
    const d = deps(google);
    const state = stateOf(await startFlow(account, 'settings', d));

    const response = await handleCalendarConnect(callbackFor(state, { code: 'the-auth-code' }), d);
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(env.appUrl);

    const tokenCall = google.calls.find((call) => call.url === GOOGLE_TOKEN_URL)!;
    const form = new URLSearchParams(String(tokenCall.init?.body));
    expect(form.get('code')).toBe('the-auth-code');
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('redirect_uri')).toBe(`${env.functionUrl}/callback`);

    const admin = asServiceRole();
    const { data: row } = await admin
      .from('calendar_accounts')
      .select('household_id, google_email, status, vault_secret_id')
      .eq('household_id', account.household.id)
      .single();
    expect(row).toMatchObject({ household_id: account.household.id, google_email: 'parent@example.com', status: 'active' });
    const { data: secret } = await admin.rpc('read_calendar_secret', { p_secret_id: row!.vault_secret_id });
    expect(secret).toBe('the-refresh-token');

    const phone = await asHouseholdAccount(account);
    const calendars = await loadMirroredCalendars(phone);
    expect(calendars.map((calendar) => calendar.name).sort()).toEqual(['Family', 'School', 'parent@example.com']);
    expect(calendars.every((calendar) => !calendar.selected && calendar.profile_id === null && calendar.color === null)).toBe(true);
  });

  it('keeps the parent’s choices and one account when the same Google account reconnects', async () => {
    const account = await arrange();
    const id = await connect(account, 'parent@example.com', 'first-token');
    const phone = await asHouseholdAccount(account);
    const [family] = (await loadMirroredCalendars(phone)).filter((calendar) => calendar.name === 'Family');
    await updateMirroredCalendar(phone, family!.id, { selected: true, profile_id: null, color: PROFILE_PALETTE[0].hex });

    expect(await connect(account, 'parent@example.com', 'second-token')).toBe(id);

    expect(await loadCalendarAccounts(phone)).toHaveLength(1);
    const after = (await loadMirroredCalendars(phone)).filter((calendar) => calendar.name === 'Family');
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ selected: true, color: PROFILE_PALETTE[0].hex });
    const admin = asServiceRole();
    const { data: row } = await admin.from('calendar_accounts').select('vault_secret_id').eq('id', id).single();
    expect((await admin.rpc('read_calendar_secret', { p_secret_id: row!.vault_secret_id })).data).toBe('second-token');
  });

  it('refuses a forged, tampered or expired state and stores nothing', async () => {
    const account = await arrange();
    const google = fakeGoogle({ email: 'parent@example.com' });
    const d = deps(google);
    const exp = Math.floor(Date.now() / 1000) + 600;
    const genuine = await signState(STATE_SECRET, { household_id: account.household.id, kind: 'settings', exp });
    const forged = await signState('attacker-secret-attacker-secret-1234', { household_id: account.household.id, kind: 'settings', exp });
    const expired = await signState(STATE_SECRET, { household_id: account.household.id, kind: 'settings', exp: exp - 3600 });
    const [payload] = genuine.split('.');
    const tampered = `${payload}x.${genuine.split('.')[1]}`;

    for (const state of [forged, expired, tampered, 'garbage']) {
      expect((await handleCalendarConnect(callbackFor(state), d)).status).toBe(400);
    }
    expect((await handleCalendarConnect(new Request(`${env.functionUrl}/callback?code=x`), d)).status).toBe(400);
    expect(google.calls).toHaveLength(0);
    const { count } = await asServiceRole()
      .from('calendar_accounts')
      .select('id', { count: 'exact', head: true })
      .eq('household_id', account.household.id);
    expect(count).toBe(0);
  });

  it('connects nothing when consent is denied, Google refuses the code, or no refresh token comes back', async () => {
    const account = await arrange();
    const state = stateOf(await startFlow(account, 'settings', deps(fakeGoogle({ email: 'a@example.com' }))));

    const denied = await handleCalendarConnect(callbackFor(state, { error: 'access_denied' }), deps(fakeGoogle({ email: 'a@example.com' })));
    expect(denied.status).toBe(400);
    const refused = await handleCalendarConnect(callbackFor(state), deps(fakeGoogle({ email: 'a@example.com', tokenStatus: 400 })));
    expect(refused.status).toBe(502);
    const noRefresh = await handleCalendarConnect(callbackFor(state), deps(fakeGoogle({ email: 'a@example.com', refreshToken: null })));
    expect(noRefresh.status).toBe(502);

    const { count } = await asServiceRole()
      .from('calendar_accounts')
      .select('id', { count: 'exact', head: true })
      .eq('household_id', account.household.id);
    expect(count).toBe(0);
  });
});

describe('the shareable consent link', () => {
  it('works with no Nidus session and attaches the account to the Household that made the link', async () => {
    const account = await arrange();
    const other = await arrange();
    const google = fakeGoogle({ email: 'partner@example.com' });
    const d = deps(google);
    const link = await startFlow(account, 'link', d);
    expect(link.startsWith(`${env.functionUrl}/consent?state=`)).toBe(true);
    const state = await verifyState(STATE_SECRET, stateOf(link), Date.now());
    expect(state?.kind).toBe('link');
    expect(state!.exp - Math.floor(Date.now() / 1000)).toBeGreaterThan(SETTINGS_STATE_SECONDS);
    expect(state!.exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(LINK_STATE_SECONDS);

    // The other adult's phone: no Authorization header at all.
    const opened = await handleCalendarConnect(new Request(link), d);
    expect(opened.status).toBe(302);
    const google_url = new URL(opened.headers.get('Location')!);
    expect(google_url.origin).toBe('https://accounts.google.com');
    expect(google_url.searchParams.get('scope')).toBe(CALENDAR_SCOPE);

    const done = await handleCalendarConnect(callbackFor(google_url.searchParams.get('state')!), d);
    expect(done.status).toBe(200);
    expect(await done.text()).toContain('Calendar connected');

    const mine = await loadCalendarAccounts(await asHouseholdAccount(account));
    expect(mine.map((row) => row.google_email)).toEqual(['partner@example.com']);
    expect(await loadCalendarAccounts(await asHouseholdAccount(other))).toEqual([]);
  });

  it('refuses a link that has expired or been altered', async () => {
    const account = await arrange();
    const d = deps(fakeGoogle({ email: 'a@example.com' }));
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = await signState(STATE_SECRET, { household_id: account.household.id, kind: 'link', exp });

    const later = deps(fakeGoogle({ email: 'a@example.com' }), { now: () => (exp + 1) * 1000 });
    expect((await handleCalendarConnect(new Request(`${env.functionUrl}/consent?state=${token}`), later)).status).toBe(400);
    expect((await handleCalendarConnect(new Request(`${env.functionUrl}/consent?state=${token}x`), d)).status).toBe(400);
    expect((await handleCalendarConnect(new Request(`${env.functionUrl}/consent`), d)).status).toBe(400);
  });
});

describe('calendar_accounts access', () => {
  it('lets the Household Account and a Device read their Household’s accounts, and nobody else', async () => {
    const account = await arrange();
    const stranger = await arrange();
    await connect(account, 'parent@example.com');
    const device = await asDevice(account);
    tablets.push(device);

    expect((await loadCalendarAccounts(await asHouseholdAccount(account))).map((row) => row.google_email)).toEqual(['parent@example.com']);
    expect((await loadCalendarAccounts(device.client)).map((row) => row.google_email)).toEqual(['parent@example.com']);
    expect(await loadCalendarAccounts(await asHouseholdAccount(stranger))).toEqual([]);
  });

  it('never exposes vault_secret_id to a Household Account, a Device or an anonymous visitor', async () => {
    const account = await arrange();
    await connect(account, 'parent@example.com');
    const device = await asDevice(account);
    tablets.push(device);
    const phone = await asHouseholdAccount(account);

    for (const client of [phone, device.client]) {
      expect((await client.from('calendar_accounts').select('vault_secret_id')).error).not.toBeNull();
      expect((await client.from('calendar_accounts').select('*')).error).not.toBeNull();
      expect((await client.from('calendar_accounts').select('id, vault_secret_id').eq('id', 'x')).error).not.toBeNull();
    }
    expect((await device.client.from('mirrored_calendars').select('sync_token')).error).not.toBeNull();
    expect((await phone.from('mirrored_calendars').select('*')).error).not.toBeNull();

    // The Vault door is the service role's alone.
    const args = { p_household_id: account.household.id, p_google_email: 'x@example.com', p_refresh_token: 'stolen' };
    expect((await phone.rpc('store_calendar_account', args)).error).not.toBeNull();
    expect((await phone.rpc('read_calendar_secret', { p_secret_id: account.household.id })).error).not.toBeNull();
    expect((await device.client.rpc('read_calendar_secret', { p_secret_id: account.household.id })).error).not.toBeNull();
    expect((await asServiceRole().from('calendar_accounts').select('vault_secret_id')).error).toBeNull();
  });

  it('lets no client create or edit an account, and only the Household Account remove one', async () => {
    const account = await arrange();
    const stranger = await arrange();
    const id = await connect(account, 'parent@example.com');
    const device = await asDevice(account);
    tablets.push(device);
    const phone = await asHouseholdAccount(account);
    const strangerPhone = await asHouseholdAccount(stranger);

    const insert = await phone.from('calendar_accounts').insert({ household_id: account.household.id, google_email: 'x@example.com', vault_secret_id: account.household.id });
    expect(insert.error).not.toBeNull();
    expect((await phone.from('calendar_accounts').update({ status: 'error' }).eq('id', id)).error).not.toBeNull();

    await device.client.from('calendar_accounts').delete().eq('id', id);
    await strangerPhone.from('calendar_accounts').delete().eq('id', id);
    expect(await loadCalendarAccounts(phone)).toHaveLength(1);
  });
});

describe('Mirrored Calendar selection', () => {
  async function arrangeWithCalendars(): Promise<{ account: HouseholdAccount; phone: Awaited<ReturnType<typeof asHouseholdAccount>>; calendars: MirroredCalendar[]; accountId: string }> {
    const account = await arrange();
    const accountId = await connect(account, 'parent@example.com');
    const phone = await asHouseholdAccount(account);
    return { account, phone, calendars: calendarsOfAccount(await loadMirroredCalendars(phone), accountId), accountId };
  }

  it('lets the Household Account select a calendar, assign a Profile, and override its colour', async () => {
    const { account, phone, calendars } = await arrangeWithCalendars();
    const profile = await createProfile(phone, account.household.id, { name: 'Sam', color: PROFILE_PALETTE[1].hex, avatar_url: null }, 0);
    const target = calendars.find((calendar) => calendar.name === 'Family')!;

    await updateMirroredCalendar(phone, target.id, { selected: true, profile_id: profile.id, color: PROFILE_PALETTE[4].hex });

    const after = (await loadMirroredCalendars(phone)).find((calendar) => calendar.id === target.id);
    expect(after).toMatchObject({ selected: true, profile_id: profile.id, color: PROFILE_PALETTE[4].hex });

    await updateMirroredCalendar(phone, target.id, { selected: true, profile_id: null, color: null });
    expect((await loadMirroredCalendars(phone)).find((calendar) => calendar.id === target.id)).toMatchObject({ profile_id: null, color: null });
  });

  it('lists the account’s selected calendars first', async () => {
    const { phone, calendars, accountId } = await arrangeWithCalendars();
    const school = calendars.find((calendar) => calendar.name === 'School')!;
    await updateMirroredCalendar(phone, school.id, { selected: true, profile_id: null, color: null });
    expect(calendarsOfAccount(await loadMirroredCalendars(phone), accountId)[0]?.name).toBe('School');
  });

  it('lets a Device read Mirrored Calendars but not change one, and no one rename or add one', async () => {
    const { account, phone, calendars } = await arrangeWithCalendars();
    const device = await asDevice(account);
    tablets.push(device);
    const target = calendars[0]!;

    expect(await loadMirroredCalendars(device.client)).toHaveLength(calendars.length);
    await device.client.from('mirrored_calendars').update({ selected: true }).eq('id', target.id);
    expect((await loadMirroredCalendars(phone)).find((calendar) => calendar.id === target.id)?.selected).toBe(false);

    expect((await phone.from('mirrored_calendars').update({ name: 'Renamed' }).eq('id', target.id)).error).not.toBeNull();
    const insert = await phone.from('mirrored_calendars').insert({
      household_id: account.household.id,
      calendar_account_id: target.calendar_account_id,
      google_calendar_id: 'extra',
      name: 'Extra',
    });
    expect(insert.error).not.toBeNull();
  });

  it('keeps each Household’s calendars to itself and refuses a Profile from another Household', async () => {
    const { phone, calendars } = await arrangeWithCalendars();
    const stranger = await arrange();
    const strangerPhone = await asHouseholdAccount(stranger);
    const foreign = await createProfile(strangerPhone, stranger.household.id, { name: 'Other', color: PROFILE_PALETTE[2].hex, avatar_url: null }, 0);
    const target = calendars[0]!;

    expect(await loadMirroredCalendars(strangerPhone)).toEqual([]);
    await strangerPhone.from('mirrored_calendars').update({ selected: true }).eq('id', target.id);
    expect((await loadMirroredCalendars(phone)).find((calendar) => calendar.id === target.id)?.selected).toBe(false);
    await expect(updateMirroredCalendar(phone, target.id, { selected: true, profile_id: foreign.id, color: null })).rejects.toBeTruthy();
  });

  it('refuses a colour that is not a #rrggbb hex', async () => {
    const { phone, calendars } = await arrangeWithCalendars();
    await expect(updateMirroredCalendar(phone, calendars[0]!.id, { selected: true, profile_id: null, color: 'red' })).rejects.toBeTruthy();
  });

  it('falls back to the whole Household when the assigned Profile is deleted', async () => {
    const { account, phone, calendars } = await arrangeWithCalendars();
    const profile = await createProfile(phone, account.household.id, { name: 'Sam', color: PROFILE_PALETTE[1].hex, avatar_url: null }, 0);
    const target = calendars[0]!;
    await updateMirroredCalendar(phone, target.id, { selected: true, profile_id: profile.id, color: null });

    await phone.from('profiles').delete().eq('id', profile.id);

    expect((await loadMirroredCalendars(phone)).find((calendar) => calendar.id === target.id)).toMatchObject({ selected: true, profile_id: null });
  });
});

describe('removing a Calendar Account', () => {
  it('deletes the Vault secret, the account and its Mirrored Calendars', async () => {
    const account = await arrange();
    const id = await connect(account, 'parent@example.com');
    const admin = asServiceRole();
    const { data: row } = await admin.from('calendar_accounts').select('vault_secret_id').eq('id', id).single<{ vault_secret_id: string }>();
    expect((await admin.rpc('read_calendar_secret', { p_secret_id: row!.vault_secret_id })).data).toBe('refresh-token-1');
    const phone = await asHouseholdAccount(account);
    expect((await loadMirroredCalendars(phone)).length).toBeGreaterThan(0);

    await removeCalendarAccount(phone, id);

    expect(await loadCalendarAccounts(phone)).toEqual([]);
    expect(await loadMirroredCalendars(phone)).toEqual([]);
    expect((await admin.rpc('read_calendar_secret', { p_secret_id: row!.vault_secret_id })).data).toBeNull();
    const { count } = await admin.from('mirrored_calendars').select('id', { count: 'exact', head: true }).eq('calendar_account_id', id);
    expect(count).toBe(0);
  });

  it('removes only the chosen account and leaves the other connected', async () => {
    const account = await arrange();
    const first = await connect(account, 'parent@example.com');
    await connect(account, 'partner@example.com', 'partner-token');
    const phone = await asHouseholdAccount(account);

    await removeCalendarAccount(phone, first);

    expect((await loadCalendarAccounts(phone)).map((row) => row.google_email)).toEqual(['partner@example.com']);
    expect((await loadMirroredCalendars(phone)).every((calendar) => calendar.calendar_account_id !== first)).toBe(true);
  });

  it('drops the Vault secret when the whole Household goes', async () => {
    const account = await arrange();
    const id = await connect(account, 'parent@example.com');
    const admin = asServiceRole();
    const { data: row } = await admin.from('calendar_accounts').select('vault_secret_id').eq('id', id).single<{ vault_secret_id: string }>();

    await destroyHousehold(account);
    households = households.filter((existing) => existing !== account);

    expect((await admin.rpc('read_calendar_secret', { p_secret_id: row!.vault_secret_id })).data).toBeNull();
  });
});
