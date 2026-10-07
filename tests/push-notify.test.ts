import { afterEach, describe, expect, it } from 'vitest';
import {
  handlePushNotify,
  type PushDeps,
  type PushPayload,
  type PushSummary,
  type PushTarget,
  type PushUrgency,
  zoned,
} from '../supabase/functions/push-notify/handler';
import { arrangeCalendar, arrangeEvents, type EventInput } from './support/calendar';
import {
  asDevice,
  asHouseholdAccount,
  asServiceRole,
  asTablet,
  createHousehold,
  destroyHousehold,
  destroyTablet,
  type HouseholdAccount,
  type Tablet,
} from './support/supabase';

// The sender (spec 0007, ticket #136) against the real local database, with a fake push service:
// `sendPush` records what would have gone to a phone. Every run is scoped to the test's own
// Household (the stack is shared) and has a fixed `now`.

const SECRET = 'push-secret-that-is-long-enough-to-matter';
const KEY = 'BApplicationServerKeyInBase64Url';
const MINUTE = 60_000;

type Sent = { endpoint: string; payload: PushPayload; urgency: PushUrgency };

// The push service: records every send and answers 'sent', or what `answers` says for an endpoint.
function fakePush(answers: Record<string, 'gone' | 'failed'> = {}) {
  const sent: Sent[] = [];
  const sendPush = (target: PushTarget, payload: PushPayload, urgency: PushUrgency) => {
    sent.push({ endpoint: target.endpoint, payload, urgency });
    return Promise.resolve<'sent' | 'gone' | 'failed'>(answers[target.endpoint] ?? 'sent');
  };
  return { sent, sendPush, to: (endpoint: string) => sent.filter((one) => one.endpoint === endpoint) };
}

function deps(account: HouseholdAccount, push: ReturnType<typeof fakePush>, now: number): PushDeps {
  return {
    env: { pushSecret: SECRET, applicationServerKey: KEY },
    admin: asServiceRole(),
    sendPush: push.sendPush,
    now: () => now,
    householdId: account.household.id,
  };
}

function post(path: string, headers: Record<string, string> = {}, body?: unknown): Request {
  return new Request(`https://nidus.test/functions/v1/push-notify${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function run(d: PushDeps): Promise<PushSummary> {
  const response = await handlePushNotify(post('', { 'x-push-secret': SECRET }), d);
  expect(response.status).toBe(200);
  return (await response.json()) as PushSummary;
}

let households: HouseholdAccount[] = [];
let tablets: Tablet[] = [];
let extraUsers: string[] = [];

afterEach(async () => {
  for (const account of households) await destroyHousehold(account);
  for (const tablet of tablets) await destroyTablet(tablet);
  for (const id of extraUsers) await asServiceRole().auth.admin.deleteUser(id);
  households = [];
  tablets = [];
  extraUsers = [];
});

async function arrange(timezone = 'America/Chicago'): Promise<HouseholdAccount> {
  const account = await createHousehold();
  households.push(account);
  if (timezone !== account.household.timezone) {
    const { error } = await asServiceRole().from('households').update({ timezone }).eq('id', account.household.id);
    if (error) throw error;
  }
  return account;
}

// A second Household Account of the same Household.
async function addAccount(account: HouseholdAccount): Promise<string> {
  const admin = asServiceRole();
  const { data, error } = await admin.auth.admin.createUser({
    email: `second-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}@nidus.test`,
    password: 'pw-second-account-123',
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error('createUser returned nothing');
  extraUsers.push(data.user.id);
  const { error: linkError } = await admin.from('household_accounts').insert({ auth_user_id: data.user.id, household_id: account.household.id });
  if (linkError) throw linkError;
  return data.user.id;
}

type Switches = { event_reminders?: boolean; reminder_minutes?: number; morning_summary?: boolean; routines_nudge?: boolean; list_additions?: boolean };
type Sub = { id: string; endpoint: string };
let endpoints = 0;

// A Push Subscription with every kind off unless the test turns it on, so a test sees only the kind it is about.
async function subscribe(authUserId: string, on: Switches = {}): Promise<Sub> {
  endpoints += 1;
  const endpoint = `https://fcm.googleapis.com/fcm/send/${Date.now().toString(36)}-${endpoints}`;
  const { data, error } = await asServiceRole()
    .from('push_subscriptions')
    .insert({
      auth_user_id: authUserId,
      endpoint,
      p256dh: 'p256dh-key',
      auth: 'auth-secret',
      event_reminders: false,
      morning_summary: false,
      routines_nudge: false,
      list_additions: false,
      ...on,
    })
    .select('id')
    .single<{ id: string }>();
  if (error || !data) throw error ?? new Error('subscription insert returned nothing');
  return { id: data.id, endpoint };
}

async function subscriptionExists(id: string): Promise<boolean> {
  const { data, error } = await asServiceRole().from('push_subscriptions').select('id').eq('id', id);
  if (error) throw error;
  return data.length === 1;
}

async function deliveries(id: string): Promise<string[]> {
  const { data, error } = await asServiceRole().from('push_deliveries').select('key').eq('subscription_id', id);
  if (error) throw error;
  return data.map((row) => row.key as string).sort();
}

const at = (ms: number) => new Date(ms).toISOString();

async function arrangeSynced(account: HouseholdAccount, events: EventInput[], selected = true): Promise<void> {
  const calendar = await arrangeCalendar(account, { selected });
  await arrangeEvents(calendar.calendarId, events);
}

let eventCounter = 0;
function event(title: string, startsAt: number, durationMinutes = 30, extra: Partial<EventInput> = {}): EventInput {
  eventCounter += 1;
  return { google_event_id: `push-${Date.now().toString(36)}-${eventCounter}`, title, starts_at: at(startsAt), ends_at: at(startsAt + durationMinutes * MINUTE), ...extra };
}

// ---- event reminders ---------------------------------------------------------------------

describe('event reminders', () => {
  // 3:00 PM in Chicago (CDT): outside the 7:00 and 19:00 windows.
  const NOW = Date.parse('2026-10-06T20:00:00Z');

  it('sends a reminder inside the window once, and never twice across two runs', async () => {
    const account = await arrange();
    const sub = await subscribe(account.authUserId, { event_reminders: true });
    await arrangeSynced(account, [event('Swim', NOW + 10 * MINUTE, 30, { location: 'Pool' })]);
    const { data: occurrence } = await asServiceRole().from('calendar_occurrences').select('source, id').eq('household_id', account.household.id).single<{ source: string; id: string }>();
    const push = fakePush();

    const first = await run(deps(account, push, NOW));
    const second = await run(deps(account, push, NOW + MINUTE));

    expect(first).toMatchObject({ subscriptions: 1, event: 1, errors: [] });
    expect(second.event).toBe(0);
    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]).toEqual({
      endpoint: sub.endpoint,
      urgency: 'normal',
      payload: {
        title: 'Swim',
        body: 'At 3:10 PM, in 10 minutes\nPool',
        url: '/day?date=2026-10-06',
        tag: `event:${occurrence!.source}:${occurrence!.id}:${NOW + 10 * MINUTE}`,
      },
    });
    expect(await deliveries(sub.id)).toEqual([push.sent[0]!.payload.tag]);
  });

  it('sends nothing for an event outside the window, all-day, past, or on an unselected calendar, and sends it once it is inside', async () => {
    const account = await arrange();
    await subscribe(account.authUserId, { event_reminders: true });
    await arrangeSynced(account, [
      event('Later', NOW + 20 * MINUTE),
      event('All day', NOW + 5 * MINUTE, 60, { is_all_day: true }),
      event('Started', NOW - MINUTE),
      event('Starting now', NOW),
    ]);
    await arrangeSynced(account, [event('Hidden', NOW + 5 * MINUTE)], false);
    const push = fakePush();

    await run(deps(account, push, NOW));
    expect(push.sent).toHaveLength(0);

    await run(deps(account, push, NOW + 6 * MINUTE));
    expect(push.sent.map((one) => one.payload.title)).toEqual(['Later']);
  });

  it('reminds of a Native Event too', async () => {
    const account = await arrange();
    await subscribe(account.authUserId, { event_reminders: true });
    const { error } = await asServiceRole()
      .from('native_events')
      .insert({ household_id: account.household.id, title: 'Dentist', starts_at: at(NOW + 5 * MINUTE), ends_at: at(NOW + 35 * MINUTE) });
    if (error) throw error;
    const push = fakePush();

    await run(deps(account, push, NOW));

    expect(push.sent.map((one) => one.payload.title)).toEqual(['Dentist']);
    expect(push.sent[0]!.payload.tag).toMatch(/^event:native:/);
  });

  it('honours each subscription\'s own lead time', async () => {
    const account = await arrange();
    const other = await addAccount(account);
    const short = await subscribe(account.authUserId, { event_reminders: true, reminder_minutes: 5 });
    const long = await subscribe(other, { event_reminders: true, reminder_minutes: 30 });
    await arrangeSynced(account, [event('Recital', NOW + 20 * MINUTE)]);
    const push = fakePush();

    await run(deps(account, push, NOW));
    expect(push.to(short.endpoint)).toHaveLength(0);
    expect(push.to(long.endpoint)).toHaveLength(1);
    expect(push.to(long.endpoint)[0]!.payload.body).toBe('At 3:20 PM, in 20 minutes');

    await run(deps(account, push, NOW + 15 * MINUTE));
    expect(push.to(short.endpoint)).toHaveLength(1);
    expect(push.to(short.endpoint)[0]!.payload.body).toBe('At 3:20 PM, in 5 minutes');
    expect(push.to(long.endpoint)).toHaveLength(1);
  });

  it('reminds at once of an event added after its reminder time but before it starts', async () => {
    const account = await arrange();
    await subscribe(account.authUserId, { event_reminders: true });
    const push = fakePush();
    await run(deps(account, push, NOW));
    await arrangeSynced(account, [event('Added late', NOW + 3 * MINUTE)]);

    await run(deps(account, push, NOW + MINUTE));

    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]!.payload.body).toBe('At 3:03 PM, in 2 minutes');
  });

  it('says "now" under a minute and gives the Household\'s own date in a zone far from UTC', async () => {
    // 10:00 AM on 2026-10-07 at +14.
    const account = await arrange('Pacific/Kiritimati');
    await subscribe(account.authUserId, { event_reminders: true });
    await arrangeSynced(account, [event('Dawn patrol', NOW + 30_000)]);
    const push = fakePush();

    await run(deps(account, push, NOW));

    expect(push.sent[0]!.payload.body).toBe('At 10:00 AM, now');
    expect(push.sent[0]!.payload.url).toBe('/day?date=2026-10-07');
  });

  it('sends once when two runs overlap', async () => {
    const account = await arrange();
    await subscribe(account.authUserId, { event_reminders: true });
    await arrangeSynced(account, [event('Swim', NOW + 10 * MINUTE)]);
    const push = fakePush();
    const d = deps(account, push, NOW);

    await Promise.all([run(d), run(d)]);

    expect(push.sent).toHaveLength(1);
  });

  it('sends nothing when the switch is off', async () => {
    const account = await arrange();
    await subscribe(account.authUserId, { event_reminders: false });
    await arrangeSynced(account, [event('Swim', NOW + 10 * MINUTE)]);
    const push = fakePush();

    expect((await run(deps(account, push, NOW))).event).toBe(0);
    expect(push.sent).toHaveLength(0);
  });
});

// ---- the morning summary -----------------------------------------------------------------

describe('the morning summary', () => {
  // 7:00 in the Household Timezone, as an instant, for the zones the spec asks about.
  const cases: { zone: string; label: string; seven: string; date: string }[] = [
    { zone: 'America/Chicago', label: 'Chicago, ordinary day', seven: '2026-10-06T12:00:00Z', date: '2026-10-06' },
    { zone: 'America/Chicago', label: 'Chicago, the spring-forward day', seven: '2026-03-08T12:00:00Z', date: '2026-03-08' },
    { zone: 'Pacific/Auckland', label: 'Auckland, the day before its clocks go back', seven: '2026-04-03T18:00:00Z', date: '2026-04-04' },
    { zone: 'Pacific/Auckland', label: 'Auckland, the day its clocks go back', seven: '2026-04-04T19:00:00Z', date: '2026-04-05' },
    { zone: 'Pacific/Kiritimati', label: 'Kiritimati, +14', seven: '2026-10-05T17:00:00Z', date: '2026-10-06' },
  ];

  it.each(cases)('sends once from 7:00 to before 10:00 on the Household clock: $label', async ({ zone, seven, date }) => {
    const account = await arrange(zone);
    await subscribe(account.authUserId, { morning_summary: true });
    const push = fakePush();
    const sevenAt = Date.parse(seven);

    await run(deps(account, push, sevenAt - MINUTE));
    expect(push.sent).toHaveLength(0);

    await run(deps(account, push, sevenAt));
    await run(deps(account, push, sevenAt + 90 * MINUTE));
    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]).toMatchObject({ urgency: 'low', payload: { title: 'Today', url: '/', tag: `morning:${date}` } });
  });

  it.each(cases)('still sends at 9:59 and is skipped at 10:00 and after: $label', async ({ zone, seven }) => {
    const sevenAt = Date.parse(seven);
    const lastMinute = await arrange(zone);
    await subscribe(lastMinute.authUserId, { morning_summary: true });
    const last = fakePush();
    await run(deps(lastMinute, last, sevenAt + 179 * MINUTE));
    expect(last.sent).toHaveLength(1);

    const late = await arrange(zone);
    await subscribe(late.authUserId, { morning_summary: true });
    const lateTo = fakePush();
    await run(deps(late, lateTo, sevenAt + 180 * MINUTE));
    await run(deps(late, lateTo, sevenAt + 300 * MINUTE));
    expect(lateTo.sent).toHaveLength(0);
  });

  it('sends again the next day, a new key', async () => {
    const account = await arrange('Pacific/Auckland');
    const sub = await subscribe(account.authUserId, { morning_summary: true });
    const push = fakePush();

    await run(deps(account, push, Date.parse('2026-04-03T18:00:00Z')));
    await run(deps(account, push, Date.parse('2026-04-04T19:00:00Z')));

    expect(await deliveries(sub.id)).toEqual([`morning:${account.household.id}:2026-04-04`, `morning:${account.household.id}:2026-04-05`]);
    expect(push.sent).toHaveLength(2);
  });

  it('lists today\'s events and meals as specified, and only today\'s', async () => {
    // Tuesday 2026-10-06; Chicago midnight is 05:00Z.
    const NOW = Date.parse('2026-10-06T12:00:00Z');
    const midnight = Date.parse('2026-10-06T05:00:00Z');
    const day = 24 * 60 * MINUTE;
    const account = await arrange();
    await subscribe(account.authUserId, { morning_summary: true });
    await arrangeSynced(account, [
      event('Holiday', midnight, 24 * 60, { is_all_day: true }),
      event('Swim', Date.parse('2026-10-06T13:30:00Z')),
      event('Last night', midnight - 3 * 60 * MINUTE),
      event('Yesterday', midnight - day, 24 * 60, { is_all_day: true }),
      event('Tomorrow', midnight + day),
      event('Tomorrow all day', midnight + day, 24 * 60, { is_all_day: true }),
    ]);
    await arrangeSynced(account, [event('Hidden', Date.parse('2026-10-06T14:00:00Z'))], false);
    const { error } = await asServiceRole()
      .from('meals')
      .insert([
        { household_id: account.household.id, meal_date: '2026-10-06', slot: 'dinner', title: 'Tacos' },
        { household_id: account.household.id, meal_date: '2026-10-06', slot: 'breakfast', title: 'Eggs' },
        { household_id: account.household.id, meal_date: '2026-10-07', slot: 'lunch', title: 'Soup' },
      ]);
    if (error) throw error;
    const push = fakePush();

    await run(deps(account, push, NOW));

    expect(push.sent[0]!.payload.body).toBe('All day: Holiday\n8:30 AM Swim\nBreakfast: Eggs\nDinner: Tacos');
  });

  it('shows four events and then "and N more", and says so when there are none', async () => {
    const NOW = Date.parse('2026-10-06T12:00:00Z');
    const account = await arrange();
    await subscribe(account.authUserId, { morning_summary: true });
    const quiet = fakePush();
    await run(deps(account, quiet, NOW));
    expect(quiet.sent[0]!.payload.body).toBe('Nothing on the calendar today.');

    const busy = await arrange();
    await subscribe(busy.authUserId, { morning_summary: true });
    await arrangeSynced(
      busy,
      [8, 9, 10, 11, 12, 13, 14].map((hour) => event(`E${hour}`, Date.parse(`2026-10-06T${String(hour + 5).padStart(2, '0')}:00:00Z`))),
    );
    const push = fakePush();
    await run(deps(busy, push, NOW));
    expect(push.sent[0]!.payload.body.split('\n')).toEqual(['8:00 AM E8', '9:00 AM E9', '10:00 AM E10', '11:00 AM E11', 'and 3 more']);
  });

  it('sends nothing when the switch is off', async () => {
    const account = await arrange();
    await subscribe(account.authUserId, { morning_summary: false });
    const push = fakePush();

    expect((await run(deps(account, push, Date.parse('2026-10-06T12:00:00Z')))).morning).toBe(0);
    expect(push.sent).toHaveLength(0);
  });
});

// ---- Routines not done -------------------------------------------------------------------

describe('Routines not done', () => {
  // 7:00 PM on Tuesday 2026-10-06 in Chicago (CDT).
  const SEVEN_PM = Date.parse('2026-10-07T00:00:00Z');
  const EVERY_DAY = 127;
  const TUESDAY = 1 << 2;
  const MONDAY = 1 << 1;

  async function arrangeProfile(account: HouseholdAccount, name: string, sortOrder: number): Promise<string> {
    const { data, error } = await asServiceRole()
      .from('profiles')
      .insert({ household_id: account.household.id, name, color: '#ffffff', sort_order: sortOrder })
      .select('id')
      .single<{ id: string }>();
    if (error || !data) throw error ?? new Error('profile insert returned nothing');
    return data.id;
  }

  async function arrangeRoutine(account: HouseholdAccount, profileId: string, title: string, days: number, archived = false): Promise<string> {
    const { data, error } = await asServiceRole()
      .from('routines')
      .insert({ household_id: account.household.id, profile_id: profileId, title, days_of_week: days, ...(archived ? { archived_at: at(SEVEN_PM) } : {}) })
      .select('id')
      .single<{ id: string }>();
    if (error || !data) throw error ?? new Error('routine insert returned nothing');
    return data.id;
  }

  // The trigger only lets a completion in for the Household's real today, even for the service role, so
  // it goes in as that and is then moved to the date the test means: no test depends on the date it runs.
  async function complete(routineId: string, date: string, timezone = 'America/Chicago'): Promise<void> {
    const admin = asServiceRole();
    const { error } = await admin.from('routine_completions').insert({ routine_id: routineId, completed_on: zoned(Date.now(), timezone).date });
    if (error) throw error;
    const { error: moveError } = await admin.from('routine_completions').update({ completed_on: date }).eq('routine_id', routineId);
    if (moveError) throw moveError;
  }

  it('lists only the Profiles with Routines left today, in order, respecting days and completions', async () => {
    const account = await arrange();
    await subscribe(account.authUserId, { routines_nudge: true });
    const mia = await arrangeProfile(account, 'Mia', 2);
    const sam = await arrangeProfile(account, 'Sam', 1);
    const kai = await arrangeProfile(account, 'Kai', 3);
    await arrangeRoutine(account, sam, 'Teeth', EVERY_DAY);
    await arrangeRoutine(account, sam, 'Reading', TUESDAY);
    await arrangeRoutine(account, sam, 'Piano', MONDAY);
    await arrangeRoutine(account, sam, 'Old chore', EVERY_DAY, true);
    const bed = await arrangeRoutine(account, mia, 'Make bed', EVERY_DAY);
    await arrangeRoutine(account, mia, 'Homework', EVERY_DAY);
    const done = await arrangeRoutine(account, kai, 'Shoes', EVERY_DAY);
    await complete(done, '2026-10-06');
    await complete(bed, '2026-10-05');
    const push = fakePush();

    await run(deps(account, push, SEVEN_PM));

    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]).toMatchObject({
      urgency: 'low',
      payload: { title: 'Routines not done', body: 'Sam: 2 left. Mia: 2 left.', url: '/routines', tag: 'routines:2026-10-06' },
    });
  });

  it('sends nothing when everybody is done', async () => {
    const account = await arrange();
    const sub = await subscribe(account.authUserId, { routines_nudge: true });
    const sam = await arrangeProfile(account, 'Sam', 1);
    await complete(await arrangeRoutine(account, sam, 'Teeth', EVERY_DAY), '2026-10-06');
    const push = fakePush();

    await run(deps(account, push, SEVEN_PM));

    expect(push.sent).toHaveLength(0);
    expect(await deliveries(sub.id)).toEqual([]);
  });

  it('sends once from 19:00 to before 22:00 and is skipped after', async () => {
    const account = await arrange();
    await subscribe(account.authUserId, { routines_nudge: true });
    const sam = await arrangeProfile(account, 'Sam', 1);
    await arrangeRoutine(account, sam, 'Teeth', EVERY_DAY);
    const early = fakePush();
    await run(deps(account, early, SEVEN_PM - MINUTE));
    expect(early.sent).toHaveLength(0);

    const push = fakePush();
    await run(deps(account, push, SEVEN_PM + 179 * MINUTE));
    await run(deps(account, push, SEVEN_PM + 179 * MINUTE + 30_000));
    expect(push.sent).toHaveLength(1);

    const late = await arrange();
    await subscribe(late.authUserId, { routines_nudge: true });
    const lateSam = await arrangeProfile(late, 'Sam', 1);
    await arrangeRoutine(late, lateSam, 'Teeth', EVERY_DAY);
    const lateTo = fakePush();
    await run(deps(late, lateTo, SEVEN_PM + 3 * 60 * MINUTE));
    expect(lateTo.sent).toHaveLength(0);
  });

  it("uses the Household's weekday and date in a zone far from UTC", async () => {
    // 7:00 PM on Tuesday 2026-10-06 in Honolulu (-10) is 05:00Z on Wednesday: UTC is a day ahead.
    const account = await arrange('Pacific/Honolulu');
    await subscribe(account.authUserId, { routines_nudge: true });
    const sam = await arrangeProfile(account, 'Sam', 1);
    await arrangeRoutine(account, sam, 'Tuesdays', TUESDAY);
    await arrangeRoutine(account, sam, 'Wednesdays', 1 << 3);
    const push = fakePush();

    await run(deps(account, push, SEVEN_PM + 5 * 60 * MINUTE));

    expect(push.sent[0]!.payload).toMatchObject({ body: 'Sam: 1 left.', tag: 'routines:2026-10-06' });
  });

  it('sends nothing when the switch is off', async () => {
    const account = await arrange();
    await subscribe(account.authUserId, { routines_nudge: false });
    const sam = await arrangeProfile(account, 'Sam', 1);
    await arrangeRoutine(account, sam, 'Teeth', EVERY_DAY);
    const push = fakePush();

    expect((await run(deps(account, push, SEVEN_PM))).routines).toBe(0);
    expect(push.sent).toHaveLength(0);
  });
});

// ---- added to the list -------------------------------------------------------------------

describe('added to the list', () => {
  const NOW = Date.parse('2026-10-06T20:00:00Z');

  async function pinned(account: HouseholdAccount): Promise<{ id: string; name: string }> {
    const admin = asServiceRole();
    const { data: household, error } = await admin.from('households').select('pinned_list_id').eq('id', account.household.id).single<{ pinned_list_id: string }>();
    if (error) throw error;
    const { data: list, error: listError } = await admin.from('shared_lists').select('id, name').eq('id', household.pinned_list_id).single<{ id: string; name: string }>();
    if (listError) throw listError;
    return list;
  }

  async function addItem(listId: string, text: string, createdAt: number, extra: { added_by?: string | null; crossed_at?: string } = {}): Promise<void> {
    const { error } = await asServiceRole().from('list_items').insert({ list_id: listId, text, created_at: at(createdAt), ...extra });
    if (error) throw error;
  }

  it('batches what is new into one notification, skips the adder, includes a Device, skips crossed, too new and too old', async () => {
    const account = await arrange();
    const other = await addAccount(account);
    const mine = await subscribe(account.authUserId, { list_additions: true });
    const theirs = await subscribe(other, { list_additions: true });
    const device = await asDevice(account);
    tablets.push(device);
    const list = await pinned(account);
    await addItem(list.id, 'eggs', NOW - 4 * MINUTE, { added_by: account.authUserId });
    await addItem(list.id, 'bread', NOW - 3 * MINUTE, { added_by: device.authUserId });
    await addItem(list.id, 'milk', NOW - 2 * MINUTE, { added_by: other });
    await addItem(list.id, 'crossed', NOW - 5 * MINUTE, { crossed_at: at(NOW - MINUTE) });
    await addItem(list.id, 'too new', NOW - 30_000);
    await addItem(list.id, 'too old', NOW - 16 * MINUTE);
    const push = fakePush();

    const summary = await run(deps(account, push, NOW));

    expect(summary.list).toBe(2);
    expect(push.to(mine.endpoint)).toHaveLength(1);
    expect(push.to(mine.endpoint)[0]).toMatchObject({
      urgency: 'low',
      payload: { title: `Added to ${list.name}`, body: 'bread, milk', url: '/lists', tag: 'list:2026-10-06' },
    });
    expect(push.to(theirs.endpoint)).toHaveLength(1);
    expect(push.to(theirs.endpoint)[0]!.payload.body).toBe('eggs, bread');
  });

  it('sends each item once: a later run carries only what has since become eligible', async () => {
    const account = await arrange();
    const sub = await subscribe(account.authUserId, { list_additions: true });
    const list = await pinned(account);
    await addItem(list.id, 'milk', NOW - 2 * MINUTE);
    await addItem(list.id, 'butter', NOW - 30_000);
    const push = fakePush();

    await run(deps(account, push, NOW));
    await run(deps(account, push, NOW));
    expect(push.sent.map((one) => one.payload.body)).toEqual(['milk']);

    await run(deps(account, push, NOW + MINUTE));
    expect(push.sent.map((one) => one.payload.body)).toEqual(['milk', 'butter']);
    expect(await deliveries(sub.id)).toHaveLength(2);
  });

  it('sends nothing when the switch is off', async () => {
    const account = await arrange();
    await subscribe(account.authUserId, { list_additions: false });
    await addItem((await pinned(account)).id, 'milk', NOW - 2 * MINUTE);
    const push = fakePush();

    expect((await run(deps(account, push, NOW))).list).toBe(0);
    expect(push.sent).toHaveLength(0);
  });
});

// ---- claiming, dead subscriptions, removed accounts ---------------------------------------

describe('claims and dead subscriptions', () => {
  const NOW = Date.parse('2026-10-06T20:00:00Z');

  it('deletes a subscription the push service says is gone, and leaves the others', async () => {
    const account = await arrange();
    const other = await addAccount(account);
    const dead = await subscribe(account.authUserId, { event_reminders: true });
    const alive = await subscribe(other, { event_reminders: true });
    await arrangeSynced(account, [event('Swim', NOW + 5 * MINUTE)]);
    const push = fakePush({ [dead.endpoint]: 'gone' });

    const summary = await run(deps(account, push, NOW));

    expect(summary).toMatchObject({ gone: 1, event: 1 });
    expect(await subscriptionExists(dead.id)).toBe(false);
    expect(await subscriptionExists(alive.id)).toBe(true);
    expect(await deliveries(dead.id)).toEqual([]);
  });

  it('counts a failed send, keeps the subscription and never retries the claimed key', async () => {
    const account = await arrange();
    const sub = await subscribe(account.authUserId, { event_reminders: true });
    await arrangeSynced(account, [event('Swim', NOW + 5 * MINUTE)]);
    const push = fakePush({ [sub.endpoint]: 'failed' });

    const first = await run(deps(account, push, NOW));
    const second = await run(deps(account, push, NOW + MINUTE));

    expect(first).toMatchObject({ failed: 1, event: 0 });
    expect(second).toMatchObject({ failed: 0, event: 0 });
    expect(push.sent).toHaveLength(1);
    expect(await subscriptionExists(sub.id)).toBe(true);
    expect(await deliveries(sub.id)).toHaveLength(1);
  });

  it('counts a send that throws as failed and goes on to the next subscription', async () => {
    const account = await arrange();
    const other = await addAccount(account);
    await subscribe(account.authUserId, { event_reminders: true });
    const fine = await subscribe(other, { event_reminders: true });
    await arrangeSynced(account, [event('Swim', NOW + 5 * MINUTE)]);
    const sent: string[] = [];
    const d = deps(account, fakePush(), NOW);
    d.sendPush = (target) => {
      if (target.endpoint !== fine.endpoint) return Promise.reject(new Error('push service down'));
      sent.push(target.endpoint);
      return Promise.resolve('sent');
    };

    expect(await run(d)).toMatchObject({ failed: 1, event: 1, errors: [] });
    expect(sent).toEqual([fine.endpoint]);
  });

  it('sends nothing to the phones of an account that was removed, and forgets them', async () => {
    const account = await arrange();
    const other = await addAccount(account);
    const kept = await subscribe(account.authUserId, { event_reminders: true });
    const removed = await subscribe(other, { event_reminders: true });
    await arrangeSynced(account, [event('Swim', NOW + 5 * MINUTE)]);
    const { error } = await asServiceRole().from('household_accounts').delete().eq('auth_user_id', other);
    if (error) throw error;
    const push = fakePush();

    const summary = await run(deps(account, push, NOW));

    expect(summary.subscriptions).toBe(1);
    expect(push.to(removed.endpoint)).toHaveLength(0);
    expect(push.to(kept.endpoint)).toHaveLength(1);
    expect(await subscriptionExists(removed.id)).toBe(false);
  });

  it('does not touch another Household\'s subscriptions when scoped', async () => {
    const account = await arrange();
    const stranger = await arrange();
    await subscribe(account.authUserId, { event_reminders: true });
    const theirs = await subscribe(stranger.authUserId, { event_reminders: true });
    await arrangeSynced(stranger, [event('Theirs', NOW + 5 * MINUTE)]);
    const push = fakePush();

    await run(deps(account, push, NOW));

    expect(push.to(theirs.endpoint)).toHaveLength(0);
  });
});

// ---- the routes --------------------------------------------------------------------------

describe('the run\'s secret', () => {
  it('refuses a wrong, missing or empty x-push-secret and a GET, and sends nothing', async () => {
    const account = await arrange();
    await subscribe(account.authUserId, { event_reminders: true });
    const push = fakePush();
    const d = deps(account, push, Date.parse('2026-10-06T20:00:00Z'));

    expect((await handlePushNotify(post('', { 'x-push-secret': `${SECRET}x` }), d)).status).toBe(401);
    expect((await handlePushNotify(post('', { 'x-push-secret': SECRET.slice(0, -1) }), d)).status).toBe(401);
    expect((await handlePushNotify(post('', { 'x-push-secret': '' }), d)).status).toBe(401);
    expect((await handlePushNotify(post(''), d)).status).toBe(401);
    expect((await handlePushNotify(new Request('https://nidus.test/functions/v1/push-notify', { method: 'GET', headers: { 'x-push-secret': SECRET } }), d)).status).toBe(405);
    expect(push.sent).toHaveLength(0);
  });
});

describe('GET /key', () => {
  it('answers the application server key as plain text, public, with CORS and nothing else', async () => {
    const account = await arrange();
    const response = await handlePushNotify(new Request('https://nidus.test/functions/v1/push-notify/key'), deps(account, fakePush(), 0));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(KEY);
    expect(response.headers.get('Content-Type')).toBe('text/plain');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

describe('CORS preflight', () => {
  it('answers OPTIONS on /test and /key, allowing authorization and content-type', async () => {
    const account = await arrange();
    for (const path of ['/test', '/key']) {
      const response = await handlePushNotify(
        new Request(`https://nidus.test/functions/v1/push-notify${path}`, { method: 'OPTIONS', headers: { Origin: 'https://nidus.test', 'Access-Control-Request-Method': 'POST' } }),
        deps(account, fakePush(), 0),
      );
      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      const allowed = (response.headers.get('Access-Control-Allow-Headers') ?? '').toLowerCase();
      expect(allowed).toContain('authorization');
      expect(allowed).toContain('content-type');
    }
  });
});

describe('POST /test', () => {
  async function tokenOf(account: HouseholdAccount): Promise<string> {
    const { data } = await (await asHouseholdAccount(account)).auth.getSession();
    return data.session!.access_token;
  }

  function test(d: PushDeps, token: string | null, body: unknown): Promise<Response> {
    return handlePushNotify(post('/test', token === null ? {} : { Authorization: `Bearer ${token}` }, body), d);
  }

  it('sends "Notifications are on" to the caller\'s own subscription only, unclaimed, with CORS', async () => {
    const account = await arrange();
    const other = await addAccount(account);
    const mine = await subscribe(account.authUserId);
    const theirs = await subscribe(other);
    const push = fakePush();

    const response = await test(deps(account, push, 0), await tokenOf(account), { endpoint: mine.endpoint });

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]!.endpoint).toBe(mine.endpoint);
    expect(push.sent[0]!.payload.title).toBe('Notifications are on');
    expect(push.to(theirs.endpoint)).toHaveLength(0);
    expect(await deliveries(mine.id)).toEqual([]);

    // Not claimed, so it can be sent again.
    expect((await test(deps(account, push, 0), await tokenOf(account), { endpoint: mine.endpoint })).status).toBe(200);
    expect(push.sent).toHaveLength(2);
  });

  it('refuses another account\'s endpoint, one that does not exist, and a missing endpoint', async () => {
    const account = await arrange();
    const stranger = await arrange();
    const theirs = await subscribe(stranger.authUserId);
    const push = fakePush();
    const token = await tokenOf(account);

    expect((await test(deps(account, push, 0), token, { endpoint: theirs.endpoint })).status).toBe(404);
    expect((await test(deps(account, push, 0), token, { endpoint: 'https://fcm.googleapis.com/fcm/send/nothing' })).status).toBe(404);
    expect((await test(deps(account, push, 0), token, {})).status).toBe(400);
    expect(push.sent).toHaveLength(0);
  });

  it('refuses a Device, an unpaired tablet, a bad token and no token', async () => {
    const account = await arrange();
    const mine = await subscribe(account.authUserId);
    const device = await asDevice(account);
    const unpaired = await asTablet();
    tablets.push(device, unpaired);
    const push = fakePush();
    const d = deps(account, push, 0);
    const tokenFor = async (tablet: Tablet) => (await tablet.client.auth.getSession()).data.session!.access_token;

    expect((await test(d, await tokenFor(device), { endpoint: mine.endpoint })).status).toBe(403);
    expect((await test(d, await tokenFor(unpaired), { endpoint: mine.endpoint })).status).toBe(403);
    expect((await test(d, 'not-a-token', { endpoint: mine.endpoint })).status).toBe(401);
    expect((await test(d, null, { endpoint: mine.endpoint })).status).toBe(401);
    expect(push.sent).toHaveLength(0);
  });

  it('deletes the subscription when the push service says it is gone', async () => {
    const account = await arrange();
    const mine = await subscribe(account.authUserId);
    const push = fakePush({ [mine.endpoint]: 'gone' });

    const response = await test(deps(account, push, 0), await tokenOf(account), { endpoint: mine.endpoint });

    expect(response.status).toBe(410);
    expect(await subscriptionExists(mine.id)).toBe(false);
  });
});
