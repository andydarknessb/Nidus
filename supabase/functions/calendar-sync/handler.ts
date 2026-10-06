// Mirroring Google Calendar into Synced Events (issues #7 and #8). One request syncs every
// active Calendar Account: read its refresh token from Vault, mint an access token, and sync
// each selected Mirrored Calendar. A plain request handler with no Deno globals and no ambient
// network, so the tests drive it under Node with an injected `fetch` returning canned Google
// responses and a real service role client against the local stack. index.ts is the only
// Deno-specific file.
//
// Who calls it: pg_cron every five minutes (public.invoke_calendar_sync), or a person
// running it by hand (docs/calendar-sync.md). Either way the `x-sync-secret` header is the
// whole authority; there is no user session.
//
// A calendar is read in full the first time, and again once a day (an occurrence of a recurring
// event that slides into the window is never in a delta) or whenever Google says its sync token
// has expired (410). In between it is read incrementally: only what changed since the token,
// applied in one transaction (apply_synced_event_changes). A full read replaces the calendar in
// one transaction too (replace_synced_events), so a failure never leaves half a mirror and the
// wall never shows a partly emptied calendar. One calendar or account failing never stops the
// others; an account Google no longer honours is marked needs_reauth and left alone until the
// parent reconnects it.
//
// An iPhone (iCloud) calendar account (spec 0005) is read from its public link instead: the whole
// feed, skipped when the server says it has not changed, its repeats expanded into the same
// window (_shared/ics-expand.ts) and stored with the same replace_synced_events. It never
// touches Google's token endpoint, and one account's failure never stops another's.
import type { SupabaseClient } from '@supabase/supabase-js';
import { type EventRow, MAX_DESCRIPTION, MAX_LOCATION, MAX_TITLE } from '../_shared/event-row.ts';
import { expandFeed } from '../_shared/ics-expand.ts';
import { fetchFeed } from '../_shared/feed.ts';
import { dayStartMs } from '../_shared/zoned-time.ts';

export type SyncEnv = {
  // Shared with the pg_cron job (Vault secret calendar_sync_secret). Long and random.
  syncSecret: string;
  googleClientId: string;
  googleClientSecret: string;
};

export type SyncDeps = {
  env: SyncEnv;
  // The service role: it reads Vault secrets and is the only writer of synced_events.
  admin: SupabaseClient;
  fetch: typeof fetch;
  // Epoch milliseconds; injectable so the window and last_synced_at are testable.
  now?: () => number;
  // Sync only this Household's accounts. The scheduled run leaves it unset (every Household);
  // the tests set it so they never touch another run's accounts on a shared local stack.
  householdId?: string;
};

export type SyncSummary = { accounts: number; calendars: number; events: number; errors: string[] };

export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_EVENTS_BASE = 'https://www.googleapis.com/calendar/v3/calendars';

// How long a calendar may go on being read incrementally before it is read in full again.
export const FULL_SYNC_EVERY_MS = 24 * 60 * 60 * 1000;

type Window = { timeMin: string; timeMax: string };

// Recurring events are stored as occurrences inside this window only (PLAN.md: Calendar).
export function syncWindow(nowMs: number): Window {
  return { timeMin: addMonths(nowMs, -1), timeMax: addMonths(nowMs, 6) };
}

// `ms` moved by whole calendar months (UTC), stopping at the end of a shorter month rather than
// spilling into the next: Mar 31 less a month is Feb 28, not Mar 3.
function addMonths(ms: number, months: number): string {
  const at = new Date(ms);
  const target = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(at.getUTCDate(), lastDay));
  target.setUTCHours(at.getUTCHours(), at.getUTCMinutes(), at.getUTCSeconds(), at.getUTCMilliseconds());
  return target.toISOString();
}

type GoogleEvent = {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function nextDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

// One Google event as a row in the Household Timezone, or null when it is cancelled or has no
// usable time. All-day events (`date`, the end exclusive) become Household midnights.
export function toRow(event: GoogleEvent, timezone: string): EventRow | null {
  if (!event.id || event.status === 'cancelled') return null;
  let startsAt: number;
  let endsAt: number;
  let isAllDay = false;
  if (event.start?.date && DATE_ONLY.test(event.start.date)) {
    isAllDay = true;
    startsAt = dayStartMs(event.start.date, timezone);
    endsAt = dayStartMs(event.end?.date && DATE_ONLY.test(event.end.date) ? event.end.date : nextDay(event.start.date), timezone);
  } else if (event.start?.dateTime) {
    startsAt = Date.parse(event.start.dateTime);
    endsAt = event.end?.dateTime ? Date.parse(event.end.dateTime) : startsAt;
  } else {
    return null;
  }
  if (Number.isNaN(startsAt) || Number.isNaN(endsAt) || endsAt < startsAt) return null;
  return {
    google_event_id: event.id,
    title: (event.summary?.trim() || '(No title)').slice(0, MAX_TITLE),
    description: event.description ? event.description.slice(0, MAX_DESCRIPTION) : null,
    location: event.location ? event.location.slice(0, MAX_LOCATION) : null,
    starts_at: new Date(startsAt).toISOString(),
    ends_at: new Date(endsAt).toISOString(),
    is_all_day: isAllDay,
  };
}

type Account = { id: string; household_id: string; vault_secret_id: string; provider: 'google' | 'icloud' };
type Calendar = {
  id: string;
  google_calendar_id: string;
  name: string;
  selected: boolean;
  sync_token: string | null;
  last_full_sync_at: string | null;
};

class SyncFailure extends Error {}

async function mintAccessToken(deps: SyncDeps, refreshToken: string): Promise<{ token: string } | { revoked: boolean; message: string }> {
  const response = await deps.fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: deps.env.googleClientId,
      client_secret: deps.env.googleClientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  if (response.ok) {
    const body = (await response.json().catch(() => ({}))) as { access_token?: string };
    if (body.access_token) return { token: body.access_token };
    return { revoked: false, message: 'Google sent no access token' };
  }
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  // invalid_grant is Google saying the refresh token is revoked, expired or replaced: only the
  // parent reconnecting the account fixes that, so retrying every five minutes would be noise.
  if (body.error === 'invalid_grant') return { revoked: true, message: 'Google no longer accepts this account. Reconnect it in settings.' };
  return { revoked: false, message: `Google token request failed (${response.status})` };
}

type Page = { items?: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string };

// Every page of one events request. `params` are the query parameters beyond the page size and
// `singleEvents`; null when the request carried a sync token and Google answers 410 (gone).
async function fetchPages(
  deps: SyncDeps,
  accessToken: string,
  googleCalendarId: string,
  params: Record<string, string>,
): Promise<{ items: GoogleEvent[]; syncToken: string | null } | null> {
  const items: GoogleEvent[] = [];
  let pageToken: string | undefined;
  let syncToken: string | null = null;
  do {
    const url = new URL(`${GOOGLE_EVENTS_BASE}/${encodeURIComponent(googleCalendarId)}/events`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('maxResults', '2500');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await deps.fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
    if (response.status === 410 && params['syncToken']) return null;
    if (!response.ok) throw new SyncFailure(`Google returned ${response.status}`);
    const body = (await response.json()) as Page;
    items.push(...(body.items ?? []));
    pageToken = body.nextPageToken;
    syncToken = body.nextSyncToken ?? syncToken;
  } while (pageToken);
  return { items, syncToken };
}

// Every non-cancelled occurrence of one calendar over the window, all pages.
async function fetchEvents(
  deps: SyncDeps,
  accessToken: string,
  googleCalendarId: string,
  window: Window,
  timezone: string,
): Promise<{ rows: EventRow[]; syncToken: string | null }> {
  const page = await fetchPages(deps, accessToken, googleCalendarId, { timeMin: window.timeMin, timeMax: window.timeMax });
  const byId = new Map<string, EventRow>();
  for (const event of page?.items ?? []) {
    const row = toRow(event, timezone);
    if (row) byId.set(row.google_event_id, row);
  }
  return { rows: [...byId.values()], syncToken: page?.syncToken ?? null };
}

type Changes = { upserts: EventRow[]; deletedIds: string[]; syncToken: string };

// Whether an occurrence overlaps the window (Google's own rule for timeMin and timeMax).
function inWindow(row: EventRow, window: Window): boolean {
  return Date.parse(row.ends_at) > Date.parse(window.timeMin) && Date.parse(row.starts_at) < Date.parse(window.timeMax);
}

// What changed in one calendar since `syncToken`; null when Google says the token has expired.
// A delta carries no window, so an occurrence outside ours (moved far away, say) is a delete.
async function fetchChanges(
  deps: SyncDeps,
  accessToken: string,
  googleCalendarId: string,
  syncToken: string,
  window: Window,
  timezone: string,
): Promise<Changes | null> {
  const page = await fetchPages(deps, accessToken, googleCalendarId, { syncToken });
  if (!page) return null;
  // The last word on an id wins: it may be changed on one page and cancelled on the next.
  const latest = new Map<string, EventRow | null>();
  for (const event of page.items) {
    if (!event.id) continue;
    const row = toRow(event, timezone);
    latest.set(event.id, row && inWindow(row, window) ? row : null);
  }
  const upserts: EventRow[] = [];
  const deletedIds: string[] = [];
  for (const [id, row] of latest) {
    if (row) upserts.push(row);
    else deletedIds.push(id);
  }
  return { upserts, deletedIds, syncToken: page.syncToken ?? syncToken };
}

async function replace(deps: SyncDeps, calendarId: string, rows: EventRow[], syncToken: string | null, nowMs: number): Promise<void> {
  const { error } = await deps.admin.rpc('replace_synced_events', {
    p_mirrored_calendar_id: calendarId,
    p_events: rows,
    p_sync_token: syncToken,
    p_synced_at: new Date(nowMs).toISOString(),
  });
  if (error) throw new SyncFailure('could not store events');
}

async function applyChanges(deps: SyncDeps, calendarId: string, changes: Changes): Promise<void> {
  const { error } = await deps.admin.rpc('apply_synced_event_changes', {
    p_mirrored_calendar_id: calendarId,
    p_upserts: changes.upserts,
    p_deleted_ids: changes.deletedIds,
    p_sync_token: changes.syncToken,
  });
  if (error) throw new SyncFailure('could not store events');
}

// Whether the calendar can be read incrementally: it has a token and was read in full recently.
function canReadIncrementally(calendar: Calendar, nowMs: number): calendar is Calendar & { sync_token: string } {
  if (!calendar.sync_token || !calendar.last_full_sync_at) return false;
  const age = nowMs - Date.parse(calendar.last_full_sync_at);
  return age >= 0 && age < FULL_SYNC_EVERY_MS;
}

// Syncs one selected calendar and returns how many events it wrote. Throws (a SyncFailure or a
// network error) with the calendar exactly as it was.
async function syncCalendar(deps: SyncDeps, accessToken: string, calendar: Calendar, window: Window, timezone: string, nowMs: number): Promise<number> {
  if (canReadIncrementally(calendar, nowMs)) {
    const changes = await fetchChanges(deps, accessToken, calendar.google_calendar_id, calendar.sync_token, window, timezone);
    if (changes) {
      await applyChanges(deps, calendar.id, changes);
      return changes.upserts.length;
    }
    // 410: Google has dropped the token. Forget it, so that if the full read below fails the
    // next run does not ask with it again, and read the calendar in full.
    const { error } = await deps.admin.from('mirrored_calendars').update({ sync_token: null, last_full_sync_at: null }).eq('id', calendar.id);
    if (error) throw new SyncFailure('could not reset the sync token');
  }
  const { rows, syncToken } = await fetchEvents(deps, accessToken, calendar.google_calendar_id, window, timezone);
  await replace(deps, calendar.id, rows, syncToken, nowMs);
  return rows.length;
}

async function failAccount(deps: SyncDeps, account: Account, summary: SyncSummary, message: string, status?: 'needs_reauth'): Promise<void> {
  summary.errors.push(`${account.id}: ${message}`);
  await deps.admin
    .from('calendar_accounts')
    .update({ last_error: message, ...(status ? { status } : {}) })
    .eq('id', account.id);
}

export const FEED_GONE_MESSAGE = 'This link no longer works. Turn on Public Calendar again and paste the new link.';

// An iPhone calendar's validator, kept in its Mirrored Calendar's sync_token (no client can read
// it) as JSON: {"etag": "...", "lastModified": "..."}, either null. Anything else reads as none,
// so the feed is read in full.
export function encodeFeedValidators(etag: string | null, lastModified: string | null): string | null {
  return etag || lastModified ? JSON.stringify({ etag, lastModified }) : null;
}

function decodeFeedValidators(token: string | null): { etag: string | null; lastModified: string | null } {
  try {
    const parsed = JSON.parse(token ?? 'null') as { etag?: unknown; lastModified?: unknown } | null;
    return {
      etag: typeof parsed?.etag === 'string' ? parsed.etag : null,
      lastModified: typeof parsed?.lastModified === 'string' ? parsed.lastModified : null,
    };
  } catch {
    return { etag: null, lastModified: null };
  }
}

// Syncs one iPhone calendar account: read its link from Vault, ask the feed whether it changed,
// and on a change expand it into the window and replace the Mirrored Calendar's events. Never
// throws, and never puts the link (or anything the feed said) in an error.
async function syncIcloudAccount(deps: SyncDeps, account: Account, timezone: string, nowMs: number, summary: SyncSummary): Promise<void> {
  const fail = (message: string, status?: 'needs_reauth') => failAccount(deps, account, summary, message, status);

  const { data: link, error: secretError } = await deps.admin.rpc('read_calendar_secret', { p_secret_id: account.vault_secret_id });
  if (secretError) return fail('Could not read the stored link.');
  if (typeof link !== 'string') return fail(FEED_GONE_MESSAGE, 'needs_reauth');

  const { data: calendars, error: listError } = await deps.admin
    .from('mirrored_calendars')
    .select('id, google_calendar_id, name, selected, sync_token, last_full_sync_at')
    .eq('calendar_account_id', account.id)
    .eq('selected', true)
    .returns<Calendar[]>();
  if (listError || !calendars) return fail('Could not read the account’s calendars.');

  const markSynced = () => deps.admin.from('calendar_accounts').update({ last_synced_at: new Date(nowMs).toISOString(), last_error: null }).eq('id', account.id);
  // Deselected: it has no events and no business with the feed.
  const calendar = calendars[0];
  if (!calendar) {
    await markSynced();
    return;
  }

  const feed = await fetchFeed(link, decodeFeedValidators(calendar.sync_token), deps.fetch);
  if (feed.kind === 'gone') return fail(FEED_GONE_MESSAGE, 'needs_reauth');
  if (feed.kind === 'error') return fail(`Could not read the iPhone calendar (${feed.message}).`);
  if (feed.kind === 'calendar') {
    const window = syncWindow(nowMs);
    let rows: EventRow[];
    try {
      rows = expandFeed(feed.text, timezone, Date.parse(window.timeMin), Date.parse(window.timeMax));
    } catch {
      return fail('Could not read the iPhone calendar (it is not a calendar the Wall can read).');
    }
    try {
      await replace(deps, calendar.id, rows, encodeFeedValidators(feed.etag, feed.lastModified), nowMs);
    } catch {
      return fail('Could not store the iPhone calendar’s events.');
    }
    summary.events += rows.length;
  }
  summary.calendars += 1;
  await markSynced();
}

// Syncs one Calendar Account. Never throws: its outcome is on the account row and in `summary`.
async function syncAccount(deps: SyncDeps, account: Account, timezone: string, nowMs: number, summary: SyncSummary): Promise<void> {
  // An iPhone calendar has no Google sign-in: it never reaches the token minting below.
  if (account.provider === 'icloud') return syncIcloudAccount(deps, account, timezone, nowMs, summary);
  const fail = (message: string, status?: 'needs_reauth') => failAccount(deps, account, summary, message, status);

  const { data: refreshToken, error: secretError } = await deps.admin.rpc('read_calendar_secret', { p_secret_id: account.vault_secret_id });
  if (secretError) return fail('Could not read the stored Google sign-in.');
  if (typeof refreshToken !== 'string') return fail('The stored Google sign-in is missing. Reconnect it in settings.', 'needs_reauth');

  const minted = await mintAccessToken(deps, refreshToken).catch((): { revoked: boolean; message: string } => ({ revoked: false, message: 'Could not reach Google' }));
  if (!('token' in minted)) return fail(minted.message, minted.revoked ? 'needs_reauth' : undefined);

  const { data: calendars, error: listError } = await deps.admin
    .from('mirrored_calendars')
    .select('id, google_calendar_id, name, selected, sync_token, last_full_sync_at')
    .eq('calendar_account_id', account.id)
    .returns<Calendar[]>();
  if (listError || !calendars) return fail('Could not read the account’s calendars.');

  const window = syncWindow(nowMs);
  const problems: string[] = [];
  for (const calendar of calendars) {
    // An un-selected calendar has no events (the database clears them the moment it is
    // un-selected) and no business with Google.
    if (!calendar.selected) continue;
    try {
      summary.events += await syncCalendar(deps, minted.token, calendar, window, timezone, nowMs);
      summary.calendars += 1;
    } catch (error) {
      // The calendar keeps its previous events; the others carry on.
      problems.push(`${calendar.name}: ${error instanceof SyncFailure ? error.message : 'could not reach Google'}`);
    }
  }

  if (problems.length > 0) return fail(problems.join('; '));
  await deps.admin.from('calendar_accounts').update({ last_synced_at: new Date(nowMs).toISOString(), last_error: null }).eq('id', account.id);
}

export async function syncAll(deps: SyncDeps): Promise<SyncSummary> {
  const nowMs = (deps.now ?? Date.now)();
  const summary: SyncSummary = { accounts: 0, calendars: 0, events: 0, errors: [] };

  let query = deps.admin.from('calendar_accounts').select('id, household_id, vault_secret_id, provider').eq('status', 'active');
  if (deps.householdId) query = query.eq('household_id', deps.householdId);
  const { data: accounts, error } = await query.returns<Account[]>();
  if (error || !accounts) {
    summary.errors.push('could not list calendar accounts');
    return summary;
  }
  if (accounts.length === 0) return summary;

  const { data: households } = await deps.admin
    .from('households')
    .select('id, timezone')
    .in('id', [...new Set(accounts.map((account) => account.household_id))])
    .returns<{ id: string; timezone: string }[]>();
  const timezones = new Map((households ?? []).map((household) => [household.id, household.timezone]));

  for (const account of accounts) {
    const timezone = timezones.get(account.household_id);
    if (!timezone) {
      summary.errors.push(`${account.id}: household timezone unknown`);
      continue;
    }
    summary.accounts += 1;
    await syncAccount(deps, account, timezone, nowMs, summary);
  }
  return summary;
}

// Compared byte by byte without stopping early, so the time taken does not say how much matched.
function sameSecret(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function handleCalendarSync(request: Request, deps: SyncDeps): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'POST only' });
  const given = request.headers.get('x-sync-secret');
  if (!given || !sameSecret(given, deps.env.syncSecret)) return json(401, { error: 'not allowed' });
  return json(200, await syncAll(deps));
}
