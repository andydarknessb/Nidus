// Mirroring Google Calendar into Synced Events (issue #7). One request syncs every active
// Calendar Account: read its refresh token from Vault, mint an access token, and fully sync
// each selected Mirrored Calendar over the window. A plain request handler with no Deno
// globals and no ambient network, so the tests drive it under Node with an injected `fetch`
// returning canned Google responses and a real service role client against the local stack.
// index.ts is the only Deno-specific file.
//
// Who calls it: pg_cron every five minutes (public.invoke_calendar_sync), or a person
// running it by hand (docs/calendar-sync.md). Either way the `x-sync-secret` header is the
// whole authority; there is no user session.
//
// Each calendar is replaced in one transaction (replace_synced_events), so a failure never
// leaves half a mirror, and an occurrence that has gone (cancelled, moved, out of the window)
// is deleted with the rest. One calendar or account failing never stops the others.
import type { SupabaseClient } from '@supabase/supabase-js';
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

const MAX_TITLE = 500;
const MAX_LOCATION = 500;
const MAX_DESCRIPTION = 8000;

// Recurring events are stored as occurrences inside this window only (PLAN.md: Calendar).
export function syncWindow(nowMs: number): { timeMin: string; timeMax: string } {
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

type EventRow = {
  google_event_id: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  is_all_day: boolean;
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

type Account = { id: string; household_id: string; vault_secret_id: string };
type Calendar = { id: string; google_calendar_id: string; name: string; selected: boolean };

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

// Every non-cancelled occurrence of one calendar over the window, all pages.
async function fetchEvents(
  deps: SyncDeps,
  accessToken: string,
  googleCalendarId: string,
  window: { timeMin: string; timeMax: string },
  timezone: string,
): Promise<{ rows: EventRow[]; syncToken: string | null }> {
  const byId = new Map<string, EventRow>();
  let pageToken: string | undefined;
  let syncToken: string | null = null;
  do {
    const url = new URL(`${GOOGLE_EVENTS_BASE}/${encodeURIComponent(googleCalendarId)}/events`);
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('timeMin', window.timeMin);
    url.searchParams.set('timeMax', window.timeMax);
    url.searchParams.set('maxResults', '2500');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await deps.fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new SyncFailure(`Google returned ${response.status}`);
    const body = (await response.json()) as { items?: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string };
    for (const event of body.items ?? []) {
      const row = toRow(event, timezone);
      if (row) byId.set(row.google_event_id, row);
    }
    pageToken = body.nextPageToken;
    syncToken = body.nextSyncToken ?? syncToken;
  } while (pageToken);
  return { rows: [...byId.values()], syncToken };
}

async function replace(deps: SyncDeps, calendarId: string, rows: EventRow[], syncToken: string | null): Promise<void> {
  const { error } = await deps.admin.rpc('replace_synced_events', {
    p_mirrored_calendar_id: calendarId,
    p_events: rows,
    p_sync_token: syncToken,
  });
  if (error) throw new SyncFailure('could not store events');
}

// Syncs one Calendar Account. Never throws: its outcome is on the account row and in `summary`.
async function syncAccount(deps: SyncDeps, account: Account, timezone: string, nowMs: number, summary: SyncSummary): Promise<void> {
  const fail = async (message: string, status?: 'needs_reauth') => {
    summary.errors.push(`${account.id}: ${message}`);
    await deps.admin
      .from('calendar_accounts')
      .update({ last_error: message, ...(status ? { status } : {}) })
      .eq('id', account.id);
  };

  const { data: refreshToken, error: secretError } = await deps.admin.rpc('read_calendar_secret', { p_secret_id: account.vault_secret_id });
  if (secretError) return fail('Could not read the stored Google sign-in.');
  if (typeof refreshToken !== 'string') return fail('The stored Google sign-in is missing. Reconnect it in settings.', 'needs_reauth');

  const minted = await mintAccessToken(deps, refreshToken).catch((): { revoked: boolean; message: string } => ({ revoked: false, message: 'Could not reach Google' }));
  if (!('token' in minted)) return fail(minted.message, minted.revoked ? 'needs_reauth' : undefined);

  const { data: calendars, error: listError } = await deps.admin
    .from('mirrored_calendars')
    .select('id, google_calendar_id, name, selected')
    .eq('calendar_account_id', account.id)
    .returns<Calendar[]>();
  if (listError || !calendars) return fail('Could not read the account’s calendars.');

  const window = syncWindow(nowMs);
  const problems: string[] = [];
  for (const calendar of calendars) {
    try {
      if (!calendar.selected) {
        // Un-selecting a calendar removes its events.
        await replace(deps, calendar.id, [], null);
        continue;
      }
      const { rows, syncToken } = await fetchEvents(deps, minted.token, calendar.google_calendar_id, window, timezone);
      await replace(deps, calendar.id, rows, syncToken);
      summary.calendars += 1;
      summary.events += rows.length;
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

  let query = deps.admin.from('calendar_accounts').select('id, household_id, vault_secret_id').eq('status', 'active');
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
