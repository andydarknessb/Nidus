// Notifications on the phone (spec 0007, ticket #136). Once a minute pg_cron posts here
// (public.invoke_push_notify); for every Push Subscription whose account is still a Household
// Account the run works out what is due (event reminders, the morning summary, Routines not
// done, additions to the Pinned List), claims each notification's key in push_deliveries and sends
// it only when the claim made a row. A claimed key is never sent again, even when the send fails:
// at most once, no retries.
//
// A plain request handler with no Deno globals and no ambient network: the tests drive it under
// Node with a fake `sendPush` and a real service role client against the local stack. index.ts
// is the only Deno-specific file (it builds `sendPush` with @negrel/webpush).
//
// Routes (the last path segment picks one):
//   GET  key    The application server key, public, plain text.
//   POST (none) The minute's run. `x-push-secret` is the whole authority; there is no user session.
//   POST test   A Household Account's Bearer token and `{ endpoint }`: "Notifications are on" to
//               that one subscription, if it is the caller's. Not claimed in push_deliveries.
//
// Every date and time of day here is in the Household Timezone (_shared/zoned-time.ts), never the
// machine's.
import type { SupabaseClient } from '@supabase/supabase-js';
import { dayStartMs, offsetMs } from '../_shared/zoned-time.ts';

export type PushEnv = {
  // Shared with the pg_cron job (Vault secret push_notify_secret). Long and random.
  pushSecret: string;
  // The VAPID public key, base64url: what a browser subscribes with.
  applicationServerKey: string;
};

export type PushPayload = { title: string; body: string; url: string; tag: string };
export type PushTarget = { endpoint: string; keys: { p256dh: string; auth: string } };
// Reminders are urgent enough to wake a phone; the rest can wait for it to wake itself.
export type PushUrgency = 'normal' | 'low';
// 'gone' is the push service saying the subscription no longer exists (404 or 410).
export type SendPush = (subscription: PushTarget, payload: PushPayload, urgency: PushUrgency) => Promise<'sent' | 'gone' | 'failed'>;

export type PushDeps = {
  env: PushEnv;
  // The service role: it reads everything and is the only writer of push_deliveries.
  admin: SupabaseClient;
  sendPush: SendPush;
  // Epoch milliseconds; injectable so every window is testable.
  now?: () => number;
  // Run for this Household only. The scheduled run leaves it unset (every Household); the tests
  // set it so they never touch another run's subscriptions on a shared local stack.
  householdId?: string;
};

export type PushSummary = {
  subscriptions: number;
  // Notifications sent, by kind.
  event: number;
  morning: number;
  routines: number;
  list: number;
  gone: number;
  failed: number;
  errors: string[];
};

export const MAX_TITLE = 80;
export const MAX_BODY = 300;
const MORNING_FROM = 7 * 60;
const MORNING_UNTIL = 10 * 60;
const ROUTINES_FROM = 19 * 60;
const ROUTINES_UNTIL = 22 * 60;
const MORNING_EVENTS = 4;
// A list addition waits a minute so a burst of typing arrives as one notification, and is let go after 15.
const LIST_WAIT_MS = 60_000;
const LIST_WINDOW_MS = 15 * 60_000;

// ---- pure: words, limits, windows ---------------------------------------------------------

// `text` cut to at most `max` characters, the last being "…" when something was cut.
export function cut(text: string, max: number): string {
  const characters = Array.from(text);
  return characters.length <= max ? text : `${characters.slice(0, max - 1).join('')}…`;
}

export function makePayload(title: string, body: string, url: string, tag: string): PushPayload {
  return { title: cut(title, MAX_TITLE), body: cut(body, MAX_BODY), url, tag };
}

export type Zoned = { date: string; minutes: number; weekday: number };

// The Household date ('YYYY-MM-DD'), the minutes since Household midnight and the weekday (Sunday 0)
// at `ms`.
export function zoned(ms: number, timezone: string): Zoned {
  const local = new Date(ms + offsetMs(ms, timezone));
  return { date: local.toISOString().slice(0, 10), minutes: local.getUTCHours() * 60 + local.getUTCMinutes(), weekday: local.getUTCDay() };
}

export function nextDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

// "8:30 AM" on the Household's clock.
export function clockWords(ms: number, timezone: string): string {
  const { minutes } = zoned(ms, timezone);
  const hour = Math.floor(minutes / 60);
  return `${hour % 12 || 12}:${String(minutes % 60).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

// "At 8:30 AM, in 15 minutes": the real minutes left, rounded, "now" under one minute. The
// location, when there is one, is a second line.
export function reminderBody(startsAt: number, now: number, timezone: string, location: string | null): string {
  const left = startsAt - now;
  const minutes = Math.round(left / 60_000);
  const when = left < 60_000 ? 'now' : `in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  const place = location?.trim();
  return `At ${clockWords(startsAt, timezone)}, ${when}${place ? `\n${place}` : ''}`;
}

export type DayEvent = { title: string; starts_at: string; is_all_day: boolean };
export type DayMeal = { slot: string; title: string };

const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
const slotWords = (slot: string): string => slot.charAt(0).toUpperCase() + slot.slice(1);

// Today's events in order ("All day: Holiday", "8:30 AM Swim"), "and 3 more" past four, then
// today's meals in slot order ("Dinner: Tacos"), one to a line. `dayStart` is the Household's
// midnight: an event that began before it and runs on is all day today.
export function morningBody(events: DayEvent[], meals: DayMeal[], dayStart: number, timezone: string): string {
  const lines: string[] = [];
  const ordered = [...events].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  for (const event of ordered.slice(0, MORNING_EVENTS)) {
    const startsAt = Date.parse(event.starts_at);
    lines.push(event.is_all_day || startsAt < dayStart ? `All day: ${event.title}` : `${clockWords(startsAt, timezone)} ${event.title}`);
  }
  if (ordered.length > MORNING_EVENTS) lines.push(`and ${ordered.length - MORNING_EVENTS} more`);
  if (ordered.length === 0) lines.push('Nothing on the calendar today.');
  for (const meal of [...meals].sort((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot))) lines.push(`${slotWords(meal.slot)}: ${meal.title}`);
  return lines.join('\n');
}

// "Sam: 2 left. Mia: 1 left."
export function routinesBody(left: { name: string; count: number }[]): string {
  return left.map(({ name, count }) => `${name}: ${count} left.`).join(' ');
}

// ---- the run ------------------------------------------------------------------------------

type Subscription = {
  id: string;
  auth_user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  event_reminders: boolean;
  reminder_minutes: number;
  morning_summary: boolean;
  routines_nudge: boolean;
  list_additions: boolean;
};
type HouseholdRow = { id: string; timezone: string; pinned_list_id: string | null };
type Occurrence = { source: string; id: string; title: string; location: string | null; starts_at: string; ends_at: string; is_all_day: boolean };
type Item = { id: string; text: string; added_by: string | null };
type Kind = 'event' | 'morning' | 'routines' | 'list';
// One notification, due for every subscription that has its kind on. `keys` are what the claim
// takes; `payload` is built from the keys that were actually claimed (a list sends only new items).
type Notification = { kind: Kind; keys: string[]; urgency: PushUrgency; payload: (claimed: string[]) => PushPayload };

function check<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data as T;
}

const iso = (ms: number): string => new Date(ms).toISOString();

async function loadList(deps: PushDeps, household: HouseholdRow, now: number): Promise<{ name: string; items: Item[] } | null> {
  if (!household.pinned_list_id) return null;
  const list = check(await deps.admin.from('shared_lists').select('name').eq('id', household.pinned_list_id).maybeSingle<{ name: string }>(), 'shared_lists');
  if (!list) return null;
  const items = check(
    await deps.admin
      .from('list_items')
      .select('id, text, added_by')
      .eq('list_id', household.pinned_list_id)
      .is('crossed_at', null)
      .gt('created_at', iso(now - LIST_WINDOW_MS))
      .lte('created_at', iso(now - LIST_WAIT_MS))
      .order('created_at', { ascending: true })
      .order('id', { ascending: true }),
    'list_items',
  ) as Item[];
  return { name: list.name, items };
}

async function morning(deps: PushDeps, household: HouseholdRow, today: Zoned): Promise<Notification> {
  const timezone = household.timezone;
  const dayStart = dayStartMs(today.date, timezone);
  const dayEnd = dayStartMs(nextDate(today.date), timezone);
  const occurrences = check(
    await deps.admin
      .from('calendar_occurrences')
      .select('title, starts_at, ends_at, is_all_day')
      .eq('household_id', household.id)
      .lt('starts_at', iso(dayEnd))
      .gte('ends_at', iso(dayStart)),
    'calendar_occurrences',
  ) as (DayEvent & { ends_at: string })[];
  // An event that ends the instant the day begins belongs to yesterday (all-day ends are exclusive).
  const events = occurrences.filter((event) => Date.parse(event.ends_at) > dayStart || Date.parse(event.starts_at) >= dayStart);
  const meals = check(
    await deps.admin.from('meals').select('slot, title').eq('household_id', household.id).eq('meal_date', today.date),
    'meals',
  ) as DayMeal[];
  const body = morningBody(events, meals, dayStart, timezone);
  const key = `morning:${today.date}`;
  return { kind: 'morning', keys: [key], urgency: 'low', payload: () => makePayload('Today', body, '/', key) };
}

async function routines(deps: PushDeps, household: HouseholdRow, today: Zoned): Promise<Notification | null> {
  const profiles = check(
    await deps.admin
      .from('profiles')
      .select('id, name')
      .eq('household_id', household.id)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true }),
    'profiles',
  ) as { id: string; name: string }[];
  const scheduled = (
    check(
      await deps.admin.from('routines').select('id, profile_id, days_of_week').eq('household_id', household.id).is('archived_at', null),
      'routines',
    ) as { id: string; profile_id: string; days_of_week: number }[]
  ).filter((routine) => ((routine.days_of_week >> today.weekday) & 1) === 1);
  if (scheduled.length === 0) return null;
  const done = new Set(
    (
      check(
        await deps.admin.from('routine_completions').select('routine_id').in('routine_id', scheduled.map((routine) => routine.id)).eq('completed_on', today.date),
        'routine_completions',
      ) as { routine_id: string }[]
    ).map((completion) => completion.routine_id),
  );
  const left = profiles
    .map(({ id, name }) => ({ name, count: scheduled.filter((routine) => routine.profile_id === id && !done.has(routine.id)).length }))
    .filter(({ count }) => count > 0);
  if (left.length === 0) return null;
  const key = `routines:${today.date}`;
  return { kind: 'routines', keys: [key], urgency: 'low', payload: () => makePayload('Routines not done', routinesBody(left), '/routines', key) };
}

// What is due for one Household's subscriptions, loaded once per Household and only if some
// subscription wants it.
async function dueFor(deps: PushDeps, household: HouseholdRow, subs: Subscription[], now: number) {
  const timezone = household.timezone;
  const today = zoned(now, timezone);
  const events: Occurrence[] = [];
  const reminderSubs = subs.filter((sub) => sub.event_reminders);
  if (reminderSubs.length > 0) {
    const horizon = Math.max(...reminderSubs.map((sub) => sub.reminder_minutes)) * 60_000;
    events.push(
      ...(check(
        await deps.admin
          .from('calendar_occurrences')
          .select('source, id, title, location, starts_at, ends_at, is_all_day')
          .eq('household_id', household.id)
          .eq('is_all_day', false)
          .gt('starts_at', iso(now))
          .lte('starts_at', iso(now + horizon))
          .order('starts_at', { ascending: true }),
        'calendar_occurrences',
      ) as Occurrence[]),
    );
  }
  const morningNotification =
    subs.some((sub) => sub.morning_summary) && today.minutes >= MORNING_FROM && today.minutes < MORNING_UNTIL ? await morning(deps, household, today) : null;
  const routinesNotification =
    subs.some((sub) => sub.routines_nudge) && today.minutes >= ROUTINES_FROM && today.minutes < ROUTINES_UNTIL ? await routines(deps, household, today) : null;
  const list = subs.some((sub) => sub.list_additions) ? await loadList(deps, household, now) : null;
  return { today, events, morningNotification, routinesNotification, list };
}

type Due = Awaited<ReturnType<typeof dueFor>>;

function notificationsFor(sub: Subscription, due: Due, timezone: string, now: number): Notification[] {
  const out: Notification[] = [];
  if (sub.event_reminders) {
    for (const event of due.events) {
      const startsAt = Date.parse(event.starts_at);
      if (startsAt - now > sub.reminder_minutes * 60_000) continue;
      const key = `event:${event.source}:${event.id}:${startsAt}`;
      out.push({
        kind: 'event',
        keys: [key],
        urgency: 'normal',
        payload: () => makePayload(event.title, reminderBody(startsAt, now, timezone, event.location), `/day?date=${zoned(startsAt, timezone).date}`, key),
      });
    }
  }
  if (sub.morning_summary && due.morningNotification) out.push(due.morningNotification);
  if (sub.routines_nudge && due.routinesNotification) out.push(due.routinesNotification);
  if (sub.list_additions && due.list) {
    // Not your own: the adder's own phone hears nothing. A Device's additions (and old rows) have
    // no matching account and go to everyone.
    const items = due.list.items.filter((item) => item.added_by !== sub.auth_user_id);
    if (items.length > 0) {
      const { name } = due.list;
      out.push({
        kind: 'list',
        keys: items.map((item) => `item:${item.id}`),
        urgency: 'low',
        payload: (claimed) =>
          makePayload(
            `Added to ${name}`,
            items.filter((item) => claimed.includes(`item:${item.id}`)).map((item) => item.text).join(', '),
            '/lists',
            `list:${due.today.date}`,
          ),
      });
    }
  }
  return out;
}

// The keys of `keys` this call newly claimed. With ignoreDuplicates the insert answers only the
// rows it made, so a key some earlier run (or a concurrent one) holds comes back absent.
async function claim(deps: PushDeps, subscriptionId: string, keys: string[]): Promise<string[]> {
  const rows = check(
    await deps.admin
      .from('push_deliveries')
      .upsert(
        keys.map((key) => ({ subscription_id: subscriptionId, key })),
        { onConflict: 'subscription_id,key', ignoreDuplicates: true },
      )
      .select('key'),
    'push_deliveries',
  ) as { key: string }[];
  return rows.map((row) => row.key);
}

async function deliver(deps: PushDeps, sub: Subscription, notifications: Notification[], summary: PushSummary): Promise<void> {
  const target: PushTarget = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
  for (const notification of notifications) {
    const claimed = await claim(deps, sub.id, notification.keys);
    if (claimed.length === 0) continue;
    let result: 'sent' | 'gone' | 'failed';
    try {
      result = await deps.sendPush(target, notification.payload(claimed), notification.urgency);
    } catch {
      result = 'failed';
    }
    if (result === 'sent') summary[notification.kind] += 1;
    else if (result === 'failed') summary.failed += 1;
    else {
      summary.gone += 1;
      check(await deps.admin.from('push_subscriptions').delete().eq('id', sub.id), 'push_subscriptions');
      return;
    }
  }
}

async function runAll(deps: PushDeps): Promise<PushSummary> {
  const now = (deps.now ?? Date.now)();
  const summary: PushSummary = { subscriptions: 0, event: 0, morning: 0, routines: 0, list: 0, gone: 0, failed: 0, errors: [] };

  // Only a Household Account's subscription counts: this is what "a removed account gets nothing" rests on.
  let accountsQuery = deps.admin.from('household_accounts').select('auth_user_id, household_id');
  if (deps.householdId) accountsQuery = accountsQuery.eq('household_id', deps.householdId);
  const accounts = check(await accountsQuery, 'household_accounts') as { auth_user_id: string; household_id: string }[];
  if (accounts.length === 0) return summary;
  const householdOf = new Map(accounts.map((account) => [account.auth_user_id, account.household_id]));

  let subsQuery = deps.admin
    .from('push_subscriptions')
    .select('id, auth_user_id, endpoint, p256dh, auth, event_reminders, reminder_minutes, morning_summary, routines_nudge, list_additions');
  if (deps.householdId) subsQuery = subsQuery.in('auth_user_id', [...householdOf.keys()]);
  const all = (check(await subsQuery, 'push_subscriptions') as Subscription[]).filter((sub) => householdOf.has(sub.auth_user_id));
  summary.subscriptions = all.length;
  if (all.length === 0) return summary;

  const byHousehold = new Map<string, Subscription[]>();
  for (const sub of all) {
    const id = householdOf.get(sub.auth_user_id)!;
    byHousehold.set(id, [...(byHousehold.get(id) ?? []), sub]);
  }
  const households = check(
    await deps.admin.from('households').select('id, timezone, pinned_list_id').in('id', [...byHousehold.keys()]),
    'households',
  ) as HouseholdRow[];

  await Promise.all(
    households.map(async (household) => {
      const subs = byHousehold.get(household.id) ?? [];
      try {
        const due = await dueFor(deps, household, subs, now);
        await Promise.all(
          subs.map(async (sub) => {
            try {
              await deliver(deps, sub, notificationsFor(sub, due, household.timezone, now), summary);
            } catch (error) {
              summary.errors.push(`subscription ${sub.id}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }),
        );
      } catch (error) {
        summary.errors.push(`household ${household.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }),
  );
  return summary;
}

// ---- routes -------------------------------------------------------------------------------

// Compared byte by byte without stopping early, so the time taken does not say how much matched.
function sameSecret(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}

// /key and /test are called from the phone's browser, so they answer CORS.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

async function test(request: Request, deps: PushDeps): Promise<Response> {
  const token = /^Bearer (.+)$/i.exec(request.headers.get('Authorization') ?? '')?.[1];
  if (!token) return json(401, { error: 'sign in first' }, cors);
  const { data: session } = await deps.admin.auth.getUser(token);
  if (!session.user) return json(401, { error: 'sign in first' }, cors);
  const { data: account } = await deps.admin
    .from('household_accounts')
    .select('auth_user_id')
    .eq('auth_user_id', session.user.id)
    .maybeSingle<{ auth_user_id: string }>();
  if (!account) return json(403, { error: 'only a Household Account gets notifications' }, cors);

  const body = (await request.json().catch(() => ({}))) as { endpoint?: unknown };
  if (typeof body.endpoint !== 'string' || body.endpoint.length === 0) return json(400, { error: 'endpoint is required' }, cors);
  // Another account's endpoint answers the same as one that does not exist.
  const { data: sub } = await deps.admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('endpoint', body.endpoint)
    .eq('auth_user_id', account.auth_user_id)
    .maybeSingle<{ id: string; endpoint: string; p256dh: string; auth: string }>();
  if (!sub) return json(404, { error: 'this phone is not subscribed' }, cors);

  const result = await deps
    .sendPush({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, makePayload('Notifications are on', 'Nidus can reach this phone.', '/settings', 'test'), 'normal')
    .catch((): 'failed' => 'failed');
  if (result === 'gone') {
    await deps.admin.from('push_subscriptions').delete().eq('id', sub.id);
    return json(410, { error: 'this phone is no longer subscribed' }, cors);
  }
  if (result === 'failed') return json(502, { error: 'the push service did not take it' }, cors);
  return json(200, { sent: true }, cors);
}

export async function handlePushNotify(request: Request, deps: PushDeps): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const route = new URL(request.url).pathname.split('/').filter(Boolean).pop();
  if (route === 'key') {
    if (request.method !== 'GET') return json(405, { error: 'GET only' });
    return new Response(deps.env.applicationServerKey, { status: 200, headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' } });
  }
  if (request.method !== 'POST') return json(405, { error: 'POST only' });
  if (route === 'test') return test(request, deps);
  const given = request.headers.get('x-push-secret');
  if (!given || !sameSecret(given, deps.env.pushSecret)) return json(401, { error: 'not allowed' });
  return json(200, await runAll(deps));
}
