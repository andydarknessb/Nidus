// What the Edge Functions repeat (calendar-connect, calendar-sync, push-notify): the check of a
// shared secret, JSON and CORS answers, and finding the Household Account a request comes from.
// No Deno globals, so the tests drive every function that uses it under Node.
import type { SupabaseClient } from '@supabase/supabase-js';

// Compared byte by byte without stopping early, so the time taken does not say how much matched.
export function sameSecret(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}

// For the routes a phone's browser calls.
export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

// A JSON answer; `headers` is `cors` for a route the browser calls.
export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

type HouseholdAccountRow = { household_id: string; auth_user_id: string };

// The Household Account of a signed-in user, optionally only of that Household; `data` is null when there is none.
export function findHouseholdAccount(admin: SupabaseClient, authUserId: string, householdId?: string) {
  const query = admin.from('household_accounts').select('household_id, auth_user_id').eq('auth_user_id', authUserId);
  return (householdId ? query.eq('household_id', householdId) : query).maybeSingle<HouseholdAccountRow>();
}

// Who is asking, for a route a Household Account or a paired Device may use: the Household either one is in. A Device is the tablet's
// anonymous session with a devices row; an unpaired session has none. 401 without a signed-in session, 403 for anyone else. Answers
// carry `cors`, since the phone and the Wall call these routes from a browser.
export async function principalOf(request: Request, admin: SupabaseClient): Promise<{ householdId: string } | Response> {
  const token = /^Bearer (.+)$/i.exec(request.headers.get('Authorization') ?? '')?.[1];
  if (!token) return json(401, { error: 'sign in first' }, cors);
  const { data: session } = await admin.auth.getUser(token);
  if (!session.user) return json(401, { error: 'sign in first' }, cors);
  const { data: account } = await findHouseholdAccount(admin, session.user.id);
  if (account) return { householdId: account.household_id };
  const { data: device } = await admin.from('devices').select('household_id').eq('auth_user_id', session.user.id).maybeSingle<{ household_id: string }>();
  if (device) return { householdId: device.household_id };
  return json(403, { error: 'not a principal of a household' }, cors);
}

// Who is asking, for the routes only a Household Account may use: its Household and user, or the
// answer to send (401 without a signed-in session, 403 with `notAllowed` for anyone else).
export async function householdAccountOf(
  request: Request,
  admin: SupabaseClient,
  notAllowed: string,
  headers: Record<string, string> = {},
): Promise<{ householdId: string; authUserId: string } | Response> {
  const token = /^Bearer (.+)$/i.exec(request.headers.get('Authorization') ?? '')?.[1];
  if (!token) return json(401, { error: 'sign in first' }, headers);
  const { data: session } = await admin.auth.getUser(token);
  if (!session.user) return json(401, { error: 'sign in first' }, headers);
  const { data: account } = await findHouseholdAccount(admin, session.user.id);
  if (!account) return json(403, { error: notAllowed }, headers);
  return { householdId: account.household_id, authUserId: account.auth_user_id };
}
