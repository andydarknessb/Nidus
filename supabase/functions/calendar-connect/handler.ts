// Connecting a Calendar Account (issue #6). The whole Google OAuth dance for one Household,
// as a plain request handler: no Deno globals and no ambient network, so the tests drive it
// under Node with an injected `fetch` returning canned Google responses and a real service
// role client against the local stack. index.ts is the only Deno-specific file.
//
// Routes (the last path segment picks one):
//   POST start     Household Account only (a Nidus session). Returns the URL to send the
//                  browser to: Google's consent screen for the parent's own account
//                  (`kind: 'settings'`), or a shareable link that opens on another adult's
//                  phone with no Nidus session (`kind: 'link'`). A settings flow may name
//                  the Google account it is for (`google_email`), which is how a Calendar
//                  Account that needs reauth is reconnected: Google offers that account first.
//   POST icloud    Household Account only, checked as start does. Adds an iPhone (iCloud)
//                  calendar from its public link: `{ url }` in, `{ id, name }` out, or an
//                  `{ error }` in words the Settings card shows. The link is normalised,
//                  fetched once so a wrong one fails at once, and stored in Vault.
//   GET  consent   The shareable link. No session: the signed `state` is the whole
//                  authority. Redirects to Google's consent screen.
//   GET  callback  Google returns here with a code. Exchanges it, stores the refresh
//                  token in Vault, upserts the Calendar Account and lists its calendars.
//
// The signed `state` parameter binds the flow to a Household and to the Household Account that
// started it: an HMAC over both ids and an expiry, so a callback can only ever attach the account
// to the Household that started the flow, and a forged or tampered state is refused. consent and
// callback also refuse a state whose account is no longer a Household Account of that Household
// (a link outlives the person who made it by up to 7 days); a state with no account is refused too.
import type { SupabaseClient } from '@supabase/supabase-js';
import { cors, findHouseholdAccount, householdAccountOf, json as jsonWith } from '../_shared/edge.ts';
import { feedCalendarName, fetchFeed, normaliseFeedUrl } from '../_shared/feed.ts';
import { exchangeCode } from '../_shared/google-token.ts';

export type ConnectEnv = {
  // Where this function is reachable from a browser, no trailing slash. Also the OAuth redirect base.
  functionUrl: string;
  // Where the app lives; the parent's own flow ends there.
  appUrl: string;
  // Signs the state parameter. Long and random; never leaves the server.
  stateSecret: string;
  googleClientId: string;
  googleClientSecret: string;
};

export type ConnectDeps = {
  env: ConnectEnv;
  // The service role: it stores Vault secrets and reads who a JWT belongs to.
  admin: SupabaseClient;
  fetch: typeof fetch;
  // Epoch milliseconds; injectable so expiry is testable.
  now?: () => number;
};

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_CALENDAR_LIST_URL = 'https://www.googleapis.com/calendar/v3/users/me/calendarList';

// The parent's own flow finishes within minutes; a link waits for another adult to open it.
export const SETTINGS_STATE_SECONDS = 30 * 60;
export const LINK_STATE_SECONDS = 7 * 24 * 60 * 60;

type FlowKind = 'settings' | 'link';
type State = { household_id: string; auth_user_id: string; kind: FlowKind; exp: number };

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array | null {
  try {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
    return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function hmacKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

export async function signState(secret: string, state: State): Promise<string> {
  const payload = toBase64Url(encoder.encode(JSON.stringify(state)));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), encoder.encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

// The state if it is genuine and unexpired; null otherwise (tampered, forged, expired, malformed).
export async function verifyState(secret: string, token: string | null, nowMs: number): Promise<State | null> {
  if (!token) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return null;
  const signatureBytes = fromBase64Url(signature);
  if (!signatureBytes) return null;
  const genuine = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret, 'verify'),
    signatureBytes as BufferSource,
    encoder.encode(payload),
  );
  if (!genuine) return null;
  const bytes = fromBase64Url(payload);
  if (!bytes) return null;
  try {
    const state = JSON.parse(new TextDecoder().decode(bytes)) as Partial<State>;
    if (
      typeof state.household_id !== 'string' ||
      typeof state.auth_user_id !== 'string' ||
      (state.kind !== 'settings' && state.kind !== 'link') ||
      typeof state.exp !== 'number' ||
      state.exp * 1000 <= nowMs
    ) {
      return null;
    }
    return { household_id: state.household_id, auth_user_id: state.auth_user_id, kind: state.kind, exp: state.exp };
  } catch {
    return null;
  }
}

// Every JSON answer of this function carries the CORS headers: the Settings page calls it from the browser.
const json = (status: number, body: unknown): Response => jsonWith(status, body, cors);

function page(status: number, title: string, message: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body style="background:#09090b;color:#fafafa;font:18px/1.5 system-ui,sans-serif;padding:2rem;max-width:32rem;margin:0 auto"><h1>${title}</h1><p>${message}</p></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function consentUrl(env: ConnectEnv, state: string, loginHint?: string): string {
  const params = new URLSearchParams({
    client_id: env.googleClientId,
    redirect_uri: `${env.functionUrl}/callback`,
    response_type: 'code',
    scope: CALENDAR_SCOPE,
    // Offline access plus a forced consent screen is what makes Google return a refresh token.
    access_type: 'offline',
    prompt: 'consent',
    state,
    ...(loginHint ? { login_hint: loginHint } : {}),
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

type GoogleCalendar = { id: string; summary?: string; summaryOverride?: string; primary?: boolean };

async function listCalendars(deps: ConnectDeps, accessToken: string): Promise<GoogleCalendar[] | null> {
  const calendars: GoogleCalendar[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(GOOGLE_CALENDAR_LIST_URL);
    url.searchParams.set('minAccessRole', 'reader');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await deps.fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) return null;
    const body = (await response.json()) as { items?: GoogleCalendar[]; nextPageToken?: string };
    calendars.push(...(body.items ?? []));
    pageToken = body.nextPageToken;
  } while (pageToken);
  return calendars;
}

// Who is asking, for the routes only a Household Account may use: its Household, or the answer to send.
const householdOf = (request: Request, deps: ConnectDeps) =>
  householdAccountOf(request, deps.admin, 'only a Household Account connects a Calendar Account', cors);

// POST start: who is asking must be a Household Account, and the state carries its Household.
async function start(request: Request, deps: ConnectDeps, now: number): Promise<Response> {
  const who = await householdOf(request, deps);
  if (who instanceof Response) return who;
  const body = (await request.json().catch(() => ({}))) as { kind?: unknown; google_email?: unknown };
  const kind: FlowKind = body.kind === 'link' ? 'link' : 'settings';
  const seconds = kind === 'link' ? LINK_STATE_SECONDS : SETTINGS_STATE_SECONDS;
  const state = await signState(deps.env.stateSecret, {
    household_id: who.householdId,
    auth_user_id: who.authUserId,
    kind,
    exp: Math.floor(now / 1000) + seconds,
  });
  // Only a hint: Google still lets the parent pick another account, and the callback attaches
  // whichever one signs in to this Household.
  const hint = typeof body.google_email === 'string' && body.google_email.length <= 320 ? body.google_email : undefined;
  return json(200, { url: kind === 'link' ? `${deps.env.functionUrl}/consent?state=${encodeURIComponent(state)}` : consentUrl(deps.env, state, hint) });
}

const NOT_A_LINK = 'That is not an iPhone calendar link.';
const COULD_NOT_READ = 'Could not read that calendar. Check the link and that Public Calendar is on.';
const ALREADY_ADDED = 'That calendar is already on the Wall.';

// POST icloud: an iPhone calendar's public link in, an account and its one Mirrored Calendar out.
async function icloud(request: Request, deps: ConnectDeps): Promise<Response> {
  const who = await householdOf(request, deps);
  if (who instanceof Response) return who;

  const body = (await request.json().catch(() => ({}))) as { url?: unknown };
  const link = typeof body.url === 'string' ? normaliseFeedUrl(body.url) : null;
  if (!link) return json(400, { error: NOT_A_LINK });

  const feed = await fetchFeed(link, { etag: null, lastModified: null }, deps.fetch);
  if (feed.kind !== 'calendar') return json(502, { error: COULD_NOT_READ });

  const name = feedCalendarName(feed.text);
  const { data: id, error } = await deps.admin.rpc('store_icloud_calendar', {
    p_household_id: who.householdId,
    p_link: link,
    p_name: name,
  });
  if (error?.code === '23505') return json(409, { error: ALREADY_ADDED });
  if (error || typeof id !== 'string') return json(500, { error: 'Something went wrong on our side. Please try again.' });
  return json(200, { id, name });
}

const expired = () => page(400, 'Link expired', 'This link is no longer valid. Ask for a new one from Nidus settings.');

// The state if it is genuine, unexpired and its account is still a Household Account of its Household;
// otherwise the page to send: Link expired, or a 500 when the lookup itself failed.
async function liveState(token: string | null, deps: ConnectDeps, now: number): Promise<State | Response> {
  const state = await verifyState(deps.env.stateSecret, token, now);
  if (!state) return expired();
  const { data, error } = await findHouseholdAccount(deps.admin, state.auth_user_id, state.household_id);
  if (error) {
    console.error('calendar-connect: household_accounts lookup failed', error);
    return page(500, 'Calendar not connected', 'Something went wrong on our side. Please try again.');
  }
  return data ? state : expired();
}

// GET consent: the shareable link. Nothing but the state proves anything: its signature, its expiry and its account still being a Household Account.
async function consent(url: URL, deps: ConnectDeps, now: number): Promise<Response> {
  const stateParam = url.searchParams.get('state');
  if (!stateParam) return expired();
  const state = await liveState(stateParam, deps, now);
  if (state instanceof Response) return state;
  return new Response(null, { status: 302, headers: { Location: consentUrl(deps.env, stateParam) } });
}

// GET callback: code for tokens, tokens into Vault, calendars into Mirrored Calendars (unselected).
async function callback(url: URL, deps: ConnectDeps, now: number): Promise<Response> {
  // Accepted limits (the #125 Ruling): a removal that commits during the Google round trips below still lands
  // (the calendars arrive unselected), and a removed-then-reinvited account's unexpired links work again.
  const state = await liveState(url.searchParams.get('state'), deps, now);
  if (state instanceof Response) return state;
  if (url.searchParams.get('error')) {
    return page(400, 'Calendar not connected', 'Calendar access was not granted, so nothing was connected. You can close this tab.');
  }
  const code = url.searchParams.get('code');
  if (!code) return page(400, 'Calendar not connected', 'Google did not send back a code. Please try again.');

  const tokens = await exchangeCode(deps.fetch, { clientId: deps.env.googleClientId, clientSecret: deps.env.googleClientSecret }, code, `${deps.env.functionUrl}/callback`);
  if (!tokens) return page(502, 'Calendar not connected', 'Google would not accept that sign-in. Please try again.');
  if (!tokens.access_token || !tokens.refresh_token) {
    return page(502, 'Calendar not connected', 'Google did not allow ongoing access. Please try again and accept every prompt.');
  }

  const calendars = await listCalendars(deps, tokens.access_token);
  // The primary calendar's id is the account's email; asking for it this way avoids a second scope.
  const email = calendars?.find((calendar) => calendar.primary)?.id;
  if (!calendars || !email) return page(502, 'Calendar not connected', 'Could not read that Google account’s calendars. Please try again.');

  const { data: accountId, error: storeError } = await deps.admin.rpc('store_calendar_account', {
    p_household_id: state.household_id,
    p_google_email: email,
    p_refresh_token: tokens.refresh_token,
  });
  if (storeError || typeof accountId !== 'string') return page(500, 'Calendar not connected', 'Something went wrong on our side. Please try again.');

  // Only the identifying columns: a reconnect keeps the parent's selection, Profile and colour.
  const { error: listError } = await deps.admin.from('mirrored_calendars').upsert(
    calendars.map((calendar) => ({
      household_id: state.household_id,
      calendar_account_id: accountId,
      google_calendar_id: calendar.id,
      name: (calendar.summaryOverride ?? calendar.summary ?? calendar.id).slice(0, 500),
    })),
    { onConflict: 'calendar_account_id,google_calendar_id' },
  );
  if (listError) return page(500, 'Calendar not connected', 'Something went wrong on our side. Please try again.');

  if (state.kind === 'settings') return new Response(null, { status: 302, headers: { Location: deps.env.appUrl } });
  return page(200, 'Calendar connected', 'Thanks. That calendar can now be chosen in the Nidus settings. You can close this tab.');
}

export async function handleCalendarConnect(request: Request, deps: ConnectDeps): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const now = (deps.now ?? Date.now)();
  const url = new URL(request.url);
  const route = url.pathname.split('/').filter(Boolean).pop();
  if (route === 'start' && request.method === 'POST') return start(request, deps, now);
  if (route === 'icloud' && request.method === 'POST') return icloud(request, deps);
  if (route === 'consent' && request.method === 'GET') return consent(url, deps, now);
  if (route === 'callback' && request.method === 'GET') return callback(url, deps, now);
  return json(404, { error: 'not found' });
}
