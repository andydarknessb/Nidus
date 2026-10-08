// The Google adapter (spec 0008): a Google Calendar Account is read through the Calendar API with
// an access token minted from the refresh token in Vault, and each selected Mirrored Calendar is
// synced in turn. A calendar is read in full the first time, and again once a day (an occurrence of a
// recurring event that slides into the window is never in a delta) or whenever Google says its sync
// token has expired (410). In between it is read incrementally: only what changed since the token,
// applied in one transaction (apply_synced_event_changes). A full read replaces the calendar in one
// transaction too (replace_synced_events), so a failure never leaves half a mirror and the wall never
// shows a partly emptied calendar. One calendar failing never stops the others; an account Google no
// longer honours is needs_reauth. Token minting is shared with calendar-connect's code exchange
// (_shared/google-token.ts).
import { type EventRow, MAX_DESCRIPTION, MAX_LOCATION, MAX_TITLE } from '../_shared/event-row.ts';
import { mintAccessToken } from '../_shared/google-token.ts';
import { addDays, dayStartMs } from '../_shared/zoned-time.ts';
import { type Calendar, canReadIncrementally, type Outcome, type ProviderAdapter, replace, SyncFailure, type SyncDeps, syncWindow, type Window } from './adapter.ts';

export const GOOGLE_EVENTS_BASE = 'https://www.googleapis.com/calendar/v3/calendars';

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
    endsAt = dayStartMs(event.end?.date && DATE_ONLY.test(event.end.date) ? event.end.date : addDays(event.start.date, 1), timezone);
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


async function applyChanges(deps: SyncDeps, calendarId: string, changes: Changes): Promise<void> {
  const { error } = await deps.admin.rpc('apply_synced_event_changes', {
    p_mirrored_calendar_id: calendarId,
    p_upserts: changes.upserts,
    p_deleted_ids: changes.deletedIds,
    p_sync_token: changes.syncToken,
  });
  if (error) throw new SyncFailure('could not store events');
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
  await replace(deps.admin, calendar.id, rows, syncToken, nowMs);
  return rows.length;
}

// Syncs one Google Calendar Account: its stored sign-in, an access token, and each selected calendar.
export function googleAdapter(deps: SyncDeps): ProviderAdapter {
  return {
    position: 0,
    leastRecentlyTriedFirst: false,
    async syncAccount({ account, timezone, nowMs }): Promise<Outcome> {
      const { data: refreshToken, error: secretError } = await deps.admin.rpc('read_calendar_secret', { p_secret_id: account.vault_secret_id });
      if (secretError) return { kind: 'failed', note: 'Could not read the stored Google sign-in.' };
      if (typeof refreshToken !== 'string') return { kind: 'needs_reauth', note: 'The stored Google sign-in is missing. Reconnect it in settings.' };

      const client = { clientId: deps.env.googleClientId, clientSecret: deps.env.googleClientSecret };
      const minted = await mintAccessToken(deps.fetch, client, refreshToken).catch((): { revoked: boolean; message: string } => ({ revoked: false, message: 'Could not reach Google' }));
      if (!('token' in minted)) return minted.revoked ? { kind: 'needs_reauth', note: minted.message } : { kind: 'failed', note: minted.message };

      const { data: calendars, error: listError } = await deps.admin
        .from('mirrored_calendars')
        .select('id, google_calendar_id, name, selected, sync_token, last_full_sync_at')
        .eq('calendar_account_id', account.id)
        .returns<Calendar[]>();
      if (listError || !calendars) return { kind: 'failed', note: 'Could not read the account’s calendars.' };

      const window = syncWindow(nowMs);
      const read = { calendars: 0, events: 0 };
      const problems: string[] = [];
      for (const calendar of calendars) {
        // An un-selected calendar has no events (the database clears them the moment it is
        // un-selected) and no business with Google.
        if (!calendar.selected) continue;
        try {
          read.events += await syncCalendar(deps, minted.token, calendar, window, timezone, nowMs);
          read.calendars += 1;
        } catch (error) {
          // The calendar keeps its previous events; the others carry on.
          problems.push(`${calendar.name}: ${error instanceof SyncFailure ? error.message : 'could not reach Google'}`);
        }
      }

      if (problems.length > 0) return { kind: 'failed', note: problems.join('; '), read };
      return { kind: 'synced', truncated: false, read };
    },
  };
}
