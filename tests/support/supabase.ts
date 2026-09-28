// The one test seam (docs/specs/0001-nidus-v1.md, Testing Decisions): the Supabase
// project boundary as the frontend sees it, driven through the Supabase JS client
// against the local stack (`pnpm db:start`), acting as a real principal. Nothing here
// mocks the database. Google's HTTP API is the only fake, and it lives with the sync
// Edge Function, not here.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const require = createRequire(import.meta.url);

type LocalStack = { url: string; anonKey: string; serviceRoleKey: string };

let cached: LocalStack | undefined;

// Reads the running local stack's keys. Env vars win so CI can inject them;
// otherwise `supabase status -o env` is the source of truth.
export function localStack(): LocalStack {
  if (cached) return cached;
  const fromEnv = {
    url: process.env['SUPABASE_URL'],
    anonKey: process.env['SUPABASE_ANON_KEY'],
    serviceRoleKey: process.env['SUPABASE_SERVICE_ROLE_KEY'],
  };
  if (fromEnv.url && fromEnv.anonKey && fromEnv.serviceRoleKey) {
    cached = { url: fromEnv.url, anonKey: fromEnv.anonKey, serviceRoleKey: fromEnv.serviceRoleKey };
    return cached;
  }
  // The CLI's JS entry, run with this Node: no shell, so no .cmd shim on Windows.
  const cliEntry = join(dirname(require.resolve('supabase/package.json')), 'dist', 'supabase.js');
  const out = execFileSync(process.execPath, [cliEntry, 'status', '-o', 'env'], { encoding: 'utf8' });
  const vars = new Map<string, string>();
  for (const line of out.split(/\r?\n/)) {
    const match = /^([A-Z_]+)="?([^"]*)"?$/.exec(line.trim());
    if (match?.[1] && match[2] !== undefined) vars.set(match[1], match[2]);
  }
  const url = vars.get('API_URL');
  const anonKey = vars.get('ANON_KEY');
  const serviceRoleKey = vars.get('SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error('Local Supabase stack is not running. Run `pnpm db:start` first.');
  }
  cached = { url, anonKey, serviceRoleKey };
  return cached;
}

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } } as const;

// Bypasses row-level security. Only the fixture uses it, to arrange state.
export function asServiceRole(): SupabaseClient {
  const { url, serviceRoleKey } = localStack();
  return createClient(url, serviceRoleKey, clientOptions);
}

// A visitor with no session: the anon key alone.
export function asAnonymous(): SupabaseClient {
  const { url, anonKey } = localStack();
  return createClient(url, anonKey, clientOptions);
}

export type Household = { id: string; name: string; timezone: string };

export type HouseholdAccount = {
  household: Household;
  email: string;
  password: string;
  authUserId: string;
};

let counter = 0;
function unique(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

// Arranges a Household with one Household Account (a real auth user) linked to it.
export async function createHousehold(name = unique('Household')): Promise<HouseholdAccount> {
  const admin = asServiceRole();
  const { data: household, error: householdError } = await admin
    .from('households')
    .insert({ name, timezone: 'America/Chicago' })
    .select('id, name, timezone')
    .single<Household>();
  if (householdError || !household) throw householdError ?? new Error('household insert returned nothing');

  const email = `${unique('account')}@nidus.test`;
  const password = `pw-${unique('secret')}`;
  const { data: created, error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userError || !created.user) throw userError ?? new Error('auth user creation returned nothing');

  const { error: linkError } = await admin
    .from('household_accounts')
    .insert({ auth_user_id: created.user.id, household_id: household.id });
  if (linkError) throw linkError;

  return { household, email, password, authUserId: created.user.id };
}

// A client signed in as the Household Account: the phone-side principal.
export async function asHouseholdAccount(account: HouseholdAccount): Promise<SupabaseClient> {
  const { url, anonKey } = localStack();
  const client = createClient(url, anonKey, clientOptions);
  const { error } = await client.auth.signInWithPassword({ email: account.email, password: account.password });
  if (error) throw error;
  return client;
}

// Removes everything a test arranged. Deleting the auth user cascades to the
// account link; deleting the Household cascades to everything under it.
export async function destroyHousehold(account: HouseholdAccount): Promise<void> {
  const admin = asServiceRole();
  await admin.auth.admin.deleteUser(account.authUserId);
  await admin.from('households').delete().eq('id', account.household.id);
}

export type Tablet = { client: SupabaseClient; authUserId: string };

// An unpaired tablet: an anonymous Supabase session, exactly what the wall
// creates on first launch.
export async function asTablet(): Promise<Tablet> {
  const { url, anonKey } = localStack();
  const client = createClient(url, anonKey, clientOptions);
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.user) throw error ?? new Error('anonymous sign-in returned no user');
  return { client, authUserId: data.user.id };
}

// Deleting the auth user cascades to its pairing requests and Device row.
export async function destroyTablet(tablet: Tablet): Promise<void> {
  await asServiceRole().auth.admin.deleteUser(tablet.authUserId);
}

export type SignedUpAccount ={ email: string; password: string; authUserId: string };

// A real auth user with no Household yet: what Google sign-in leaves behind on
// the first visit, before the app calls ensure_household.
export async function createSignedUpAccount(): Promise<SignedUpAccount> {
  const admin = asServiceRole();
  const email = `${unique('newcomer')}@nidus.test`;
  const password = `pw-${unique('secret')}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error('auth user creation returned nothing');
  return { email, password, authUserId: data.user.id };
}

export async function signInAs(account: { email: string; password: string }): Promise<SupabaseClient> {
  const { url, anonKey } = localStack();
  const client = createClient(url, anonKey, clientOptions);
  const { error } = await client.auth.signInWithPassword(account);
  if (error) throw error;
  return client;
}

// Removes a signed-up account and any Household it ended up owning.
export async function destroySignedUpAccount(account: SignedUpAccount): Promise<void> {
  const admin = asServiceRole();
  const { data } = await admin.from('household_accounts').select('household_id').eq('auth_user_id', account.authUserId);
  await admin.auth.admin.deleteUser(account.authUserId);
  for (const row of data ?? []) await admin.from('households').delete().eq('id', row.household_id);
}
