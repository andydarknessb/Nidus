import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';

// Calendar Accounts and Mirrored Calendars (CONTEXT.md). Every function takes the
// client so the same code runs in the app and in tests against the local stack.
// The Household Account chooses and removes; a Device only reads. The Google
// connection itself is the calendar-connect Edge Function; the refresh token never
// reaches a client, and neither does the column that names its Vault secret.

export type CalendarAccountStatus = 'active' | 'needs_reauth';
export type CalendarProvider = 'google' | 'icloud';

export type CalendarAccount = {
  id: string;
  provider: CalendarProvider;
  // Null for an iPhone (iCloud) calendar, which has no Google email.
  google_email: string | null;
  status: CalendarAccountStatus;
  last_synced_at: string | null;
  last_error: string | null;
};

export type MirroredCalendar = {
  id: string;
  calendar_account_id: string;
  google_calendar_id: string;
  name: string;
  // A colour the Wall no longer draws: a Mirrored Calendar has none of its own (an event is its Profiles' colours). The column stays.
  color: string | null;
  // Null means the whole Household.
  profile_id: string | null;
  selected: boolean;
};

// What a write changes of a Mirrored Calendar: only the fields it names are written. The phone sends one at a time, `{ selected }`
// for the switch and `{ profile_id }` for whose it is, so that a slow answer to one never writes the other's old value back. There
// is no colour to choose, since nothing draws one: nothing writes the column (it stays).
export type MirroredCalendarChoice = { selected?: boolean; profile_id?: string | null };

// Explicit column lists: `select *` on these tables is refused, because vault_secret_id
// and sync_token are not granted to clients.
const accountColumns = 'id, provider, google_email, status, last_synced_at, last_error';
const calendarColumns = 'id, calendar_account_id, google_calendar_id, name, color, profile_id, selected';

export async function loadCalendarAccounts(client: SupabaseClient): Promise<CalendarAccount[]> {
  const { data, error } = await client.from('calendar_accounts').select(accountColumns).order('created_at');
  if (error) throw error;
  return data as CalendarAccount[];
}

export async function loadMirroredCalendars(client: SupabaseClient): Promise<MirroredCalendar[]> {
  const { data, error } = await client.from('mirrored_calendars').select(calendarColumns).order('name');
  if (error) throw error;
  return data as MirroredCalendar[];
}

// The URL to send the browser to: Google's consent screen for the parent's own
// account ('settings'), or a link to hand to another adult ('link'). `googleEmail` names the
// account a reconnect is for, so Google offers it first.
export async function startCalendarConnect(client: SupabaseClient, kind: 'settings' | 'link', googleEmail?: string): Promise<string> {
  const { data, error } = await client.functions.invoke<{ url: string }>('calendar-connect/start', {
    body: googleEmail ? { kind, google_email: googleEmail } : { kind },
  });
  if (error || !data?.url) throw error ?? new Error('calendar-connect returned no url');
  return data.url;
}

export const IPHONE_ADD_FAILED = 'Could not add that calendar. Try again.';
export const IPHONE_ADDED = 'Added. First sync within 5 minutes.';

// The route's own refusal, in words for the family: a link that is not an iPhone calendar link (400), one already added (409), one
// that could not be read (502). Nothing else the route says (a missing session, a Device, a crash) is for the family to read.
export class AddRefused extends Error {}
const FAMILY_STATUSES: ReadonlySet<number> = new Set([400, 409, 502]);

// Adds an iPhone calendar from its public link; the link itself is never kept here. A refusal in the route's family words throws
// AddRefused; any other answer from the route throws AddRefused with the plain fallback. A request that got no answer throws what
// supabase-js threw, so that the page words it as it words every write that did not reach the server (offline, or not).
export async function addIphoneCalendar(client: SupabaseClient, url: string): Promise<void> {
  const { error } = await client.functions.invoke<{ id: string; name: string }>('calendar-connect/icloud', { body: { url } });
  if (!error) return;
  if (!(error instanceof FunctionsHttpError)) throw error;
  const words = FAMILY_STATUSES.has(error.context.status) ? ((await error.context.json().catch(() => null)) as { error?: unknown } | null)?.error : null;
  throw new AddRefused(typeof words === 'string' ? words : IPHONE_ADD_FAILED);
}

// What the Add button's press came to, for the card to show.
export type PressAddResult =
  | { kind: 'ignored' }
  | { kind: 'added'; clear: boolean; say: string }
  | { kind: 'refused'; words: string }
  | { kind: 'failed'; error: unknown };

// One press of Add. `state.adding` is the guard: a press while a link is being added is ignored, and the flag is down again when
// the answer is. The field is cleared on success only if it still holds the link that was sent, so what was typed meanwhile is kept.
export async function pressAdd(options: {
  link: string;
  state: { adding: boolean };
  current: () => string;
  add: (url: string) => Promise<void>;
}): Promise<PressAddResult> {
  const { state } = options;
  if (state.adding) return { kind: 'ignored' };
  state.adding = true;
  const sent = options.link.trim();
  try {
    await options.add(sent);
    return { kind: 'added', clear: options.current().trim() === sent, say: IPHONE_ADDED };
  } catch (error) {
    return error instanceof AddRefused ? { kind: 'refused', words: error.message } : { kind: 'failed', error };
  } finally {
    state.adding = false;
  }
}

export async function updateMirroredCalendar(
  client: SupabaseClient,
  id: string,
  choice: MirroredCalendarChoice,
): Promise<void> {
  const { error } = await client.from('mirrored_calendars').update(choice).eq('id', id);
  if (error) throw error;
}

// Deletes the account; the database drops its Vault secret and its Mirrored Calendars with it.
export async function removeCalendarAccount(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('calendar_accounts').delete().eq('id', id);
  if (error) throw error;
}

// What the screen has asked of a calendar that has not been answered yet (one field, or both asked at different moments).
export type PendingChoice = { selected?: boolean; profile_id?: string | null };

// A calendar as the screen shows it while its changes are on their way: what is stored with what was asked laid over it, so that a
// tick shows at once and a person chosen shows at once.
export function shownCalendar(calendar: MirroredCalendar, pending: PendingChoice | undefined): MirroredCalendar {
  return pending === undefined ? calendar : { ...calendar, ...pending };
}

// What is still pending of a calendar once `answered` has been answered, whether it landed or failed: a field that is still what
// that change asked for is no longer pending (it is stored, or it goes back to what is stored), and a field asked for again since,
// which has an answer of its own to wait for, stays. Nothing left is undefined.
export function stillPending(pending: PendingChoice | undefined, answered: PendingChoice): PendingChoice | undefined {
  if (pending === undefined) return undefined;
  const left: PendingChoice = { ...pending };
  if ('selected' in answered && left.selected === answered.selected) delete left.selected;
  if ('profile_id' in answered && left.profile_id === answered.profile_id) delete left.profile_id;
  return Object.keys(left).length === 0 ? undefined : left;
}

// The account's calendars, selected ones first, the way the screen lists them.
export function calendarsOfAccount(calendars: MirroredCalendar[], accountId: string): MirroredCalendar[] {
  return calendars
    .filter((calendar) => calendar.calendar_account_id === accountId)
    .sort((a, b) => Number(b.selected) - Number(a.selected) || a.name.localeCompare(b.name));
}

// ---- How fresh the mirror is (issue #8) ----------------------------------------------------

// The wall says nothing about freshness until an account is more than this far behind.
export const SYNC_STALE_MS = 60 * 60 * 1000;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

// How long ago, in the words the settings screen and the wall use. Rounds down.
export function formatAge(ageMs: number): string {
  if (ageMs < MINUTE_MS) return 'just now';
  if (ageMs < HOUR_MS) return `${plural(Math.floor(ageMs / MINUTE_MS), 'minute')} ago`;
  if (ageMs < DAY_MS) return `${plural(Math.floor(ageMs / HOUR_MS), 'hour')} ago`;
  return `${plural(Math.floor(ageMs / DAY_MS), 'day')} ago`;
}

// One Calendar Account's last sync, for the settings screen.
export function lastSyncedText(lastSyncedAt: string | null, nowMs: number): string {
  return lastSyncedAt === null ? 'Not synced yet' : `Last synced ${formatAge(nowMs - Date.parse(lastSyncedAt))}`;
}

// What an account whose last update failed says, in words and not in the provider's: the sync runs every five minutes
// (docs/calendar-sync.md), so a failure mends itself unless the sign-in itself has gone.
export const UPDATE_FAILED_WORDS = 'Connected, but the last update failed. Nidus tries again every 5 minutes.';

// How the settings screen says an account is doing. `last_error` is whatever the sync wrote when it failed, which is for the
// logs: it is never shown. The one exception is an iPhone calendar whose link broke: the sync writes that sentence itself, in the
// family's words (spec 0005), and it is what tells them what to do.
export function accountStatusText(account: Pick<CalendarAccount, 'status' | 'last_error'> & Partial<Pick<CalendarAccount, 'provider'>>): string {
  if (account.status === 'needs_reauth') return account.provider === 'icloud' && account.last_error ? account.last_error : 'Needs to be connected again';
  return account.last_error ? UPDATE_FAILED_WORDS : 'Connected';
}

// What the wall needs to know about each account to say whether the mirror is behind.
export type SyncFreshness = { last_synced_at: string | null; created_at: string };

export async function loadSyncFreshness(client: SupabaseClient): Promise<SyncFreshness[]> {
  const { data, error } = await client.from('calendar_accounts').select('last_synced_at, created_at');
  if (error) throw error;
  return data as SyncFreshness[];
}

// The wall's badge: null while every account is within an hour of now, otherwise how far behind
// the furthest-behind one is. An account that has never synced counts from when it was connected.
export function staleSyncBadge(accounts: SyncFreshness[], nowMs: number): string | null {
  const worst = furthestBehind(accounts, nowMs);
  if (worst === null) return null;
  return worst.synced ? `Last synced ${formatAge(nowMs - worst.since)}` : 'Not synced yet';
}

// The same mark in as few characters as it can be said in, for the phone's header: "3 h", "2 d", or "Not synced". The words of
// staleSyncBadge are still what a screen reader hears.
export function staleSyncShort(accounts: SyncFreshness[], nowMs: number): string | null {
  const worst = furthestBehind(accounts, nowMs);
  if (worst === null) return null;
  if (!worst.synced) return 'Not synced';
  const age = nowMs - worst.since;
  return age < DAY_MS ? `${Math.floor(age / HOUR_MS)} h` : `${Math.floor(age / DAY_MS)} d`;
}

function furthestBehind(accounts: SyncFreshness[], nowMs: number): { since: number; synced: boolean } | null {
  let worst: { since: number; synced: boolean } | null = null;
  for (const account of accounts) {
    const synced = account.last_synced_at !== null;
    const since = Date.parse(account.last_synced_at ?? account.created_at);
    if (Number.isNaN(since) || nowMs - since <= SYNC_STALE_MS) continue;
    if (worst === null || since < worst.since) worst = { since, synced };
  }
  return worst;
}
