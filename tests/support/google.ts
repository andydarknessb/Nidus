// The one fake Google, for every test that drives an Edge Function (calendar-sync, calendar-connect)
// through its handler. Google's HTTP API is the only thing faked, injected as the function's `fetch`:
// the token endpoint (a refresh token for the sync, an authorization code for the connect flow), the
// calendar list, and a calendar's events endpoint (full, paged and incremental reads).
import { GOOGLE_CALENDAR_LIST_URL } from '../../supabase/functions/calendar-connect/handler';
import { GOOGLE_TOKEN_URL } from '../../supabase/functions/_shared/google-token';

export type GoogleEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
};

export type GoogleCall = { url: URL; init?: RequestInit };

export type FakeGoogleOptions = {
  // ---- the connect flow
  // The Google account that signs in: its primary calendar is its email.
  email?: string;
  // What the code exchange hands back; null for a response with no refresh token.
  refreshToken?: string | null;
  // The account's calendar list, when it is not the primary and two more.
  calendars?: { id: string; summary: string; primary?: boolean }[];
  // Makes the token endpoint answer this HTTP status instead of tokens.
  tokenStatus?: number;
  // ---- the sync
  // Events keyed by Google calendar id; a number is an HTTP failure status for that calendar.
  events?: Record<string, GoogleEvent[] | number>;
  // refresh token -> true when Google still honours it (every one it is not told about is honoured).
  refreshTokens?: Record<string, boolean>;
  pageSize?: number;
  syncToken?: string;
  // What an incremental request (one carrying a sync token) gets back, keyed by that token: the
  // changed events and the next token, or an HTTP failure status (410: the token expired).
  incremental?: Record<string, { items: GoogleEvent[]; nextSyncToken?: string } | number>;
};

export function fakeGoogle(options: FakeGoogleOptions = {}): { fetch: typeof fetch; calls: GoogleCall[] } {
  const calls: GoogleCall[] = [];
  const email = options.email ?? 'parent@example.com';
  const calendars = options.calendars ?? [
    { id: email, summary: email, primary: true },
    { id: 'family@group.calendar.google.com', summary: 'Family' },
    { id: 'school@group.calendar.google.com', summary: 'School' },
  ];
  const status = (code: number) => Promise.resolve(new Response('{}', { status: code }));

  const fake = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    calls.push(init ? { url, init } : { url });

    if (String(input) === GOOGLE_TOKEN_URL) {
      if (options.tokenStatus && options.tokenStatus !== 200) return status(options.tokenStatus);
      const form = new URLSearchParams(String(init?.body));
      if (form.get('grant_type') === 'authorization_code') {
        const body: Record<string, string> = { access_token: 'access-token' };
        if (options.refreshToken !== null) body['refresh_token'] = options.refreshToken ?? 'refresh-token-1';
        return Promise.resolve(Response.json(body));
      }
      const refresh = form.get('refresh_token') ?? '';
      if (form.get('grant_type') !== 'refresh_token' || options.refreshTokens?.[refresh] === false) {
        return Promise.resolve(Response.json({ error: 'invalid_grant' }, { status: 400 }));
      }
      return Promise.resolve(Response.json({ access_token: `access-for-${refresh}`, expires_in: 3600 }));
    }

    if (String(input).startsWith(GOOGLE_CALENDAR_LIST_URL)) return Promise.resolve(Response.json({ items: calendars }));

    const match = /\/calendars\/([^/]+)\/events$/.exec(url.pathname);
    if (!match) return Promise.resolve(new Response('unexpected', { status: 500 }));
    const calendarId = decodeURIComponent(match[1]!);
    const given = url.searchParams.get('syncToken');
    if (given !== null) {
      // Google refuses a delta that also names a window.
      if (url.searchParams.has('timeMin') || url.searchParams.has('timeMax')) return status(400);
      const delta = options.incremental?.[given];
      if (delta === undefined) return status(410);
      if (typeof delta === 'number') return status(delta);
      return Promise.resolve(Response.json({ items: delta.items, nextSyncToken: delta.nextSyncToken ?? 'sync-token-next' }));
    }
    const events = options.events?.[calendarId];
    if (events === undefined) return status(404);
    if (typeof events === 'number') return status(events);
    const size = options.pageSize ?? 1000;
    const offset = Number(url.searchParams.get('pageToken') ?? 0);
    const more = offset + size < events.length;
    return Promise.resolve(
      Response.json({
        items: events.slice(offset, offset + size),
        ...(more ? { nextPageToken: String(offset + size) } : { nextSyncToken: options.syncToken ?? 'sync-token-1' }),
      }),
    );
  };
  return { fetch: fake as typeof fetch, calls };
}

// The requests that asked for a calendar's events, in order.
export const eventCalls = (google: { calls: GoogleCall[] }): GoogleCall[] => google.calls.filter((call) => call.url.pathname.endsWith('/events'));
