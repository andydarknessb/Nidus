import { supabase } from './supabase';

export type HouseholdInvite = { createdAt: Date; expiresAt: Date };

export type HouseholdAccountRow = { authUserId: string; email: string; createdAt: Date };

export type JoinOutcome = 'joined' | 'expired' | 'other-household';

// The two refusals accept_household_invite raises: any link that does not work, and a Google
// account that already belongs to another Household.
const DEAD_LINK = 'PT410';
const OTHER_HOUSEHOLD = 'PT409';

export function inviteLink(origin: string, token: string): string {
  return `${origin}/join/${token}`;
}

// The token of a '/join/<token>' path, or null for anything else. A token is exactly 64 lowercase hex characters.
export function joinTokenOf(pathname: string): string | null {
  return /^\/join\/([0-9a-f]{64})$/.exec(pathname)?.[1] ?? null;
}

// The Household's invite, or null when there is none or it has expired. Never the token: only its hash is stored.
export async function readHouseholdInvite(householdId: string): Promise<HouseholdInvite | null> {
  const { data, error } = await supabase
    .from('household_invites')
    .select('created_at, expires_at')
    .eq('household_id', householdId)
    .maybeSingle<{ created_at: string; expires_at: string }>();
  if (error) throw error;
  if (!data) return null;
  const invite = { createdAt: new Date(data.created_at), expiresAt: new Date(data.expires_at) };
  return invite.expiresAt.getTime() > Date.now() ? invite : null;
}

// Makes the Household's invite, replacing any earlier one. The token comes back this once.
export async function createHouseholdInvite(): Promise<{ token: string; expiresAt: Date }> {
  const { data, error } = await supabase.rpc('create_household_invite').single<{ token: string; expires_at: string }>();
  if (error) throw error;
  return { token: data.token, expiresAt: new Date(data.expires_at) };
}

export async function cancelHouseholdInvite(): Promise<void> {
  const { error } = await supabase.rpc('cancel_household_invite');
  if (error) throw error;
}

// 'expired' covers every link that does not work, as the database refuses them all alike.
export async function acceptHouseholdInvite(token: string): Promise<JoinOutcome> {
  const { error } = await supabase.rpc('accept_household_invite', { p_token: token });
  if (!error) return 'joined';
  if (error.code === DEAD_LINK) return 'expired';
  if (error.code === OTHER_HOUSEHOLD) return 'other-household';
  throw error;
}

export async function listHouseholdAccounts(): Promise<HouseholdAccountRow[]> {
  const { data, error } = await supabase.rpc('household_account_list');
  if (error) throw error;
  const rows = data as { auth_user_id: string; email: string; created_at: string }[];
  return rows.map((row) => ({ authUserId: row.auth_user_id, email: row.email, createdAt: new Date(row.created_at) }));
}

// Removes another Household Account of this Household; true when it was removed (and the Household's invite cancelled with
// it). The database refuses your own and any other Household's by answering false, which is not an error: nothing changed.
export async function removeHouseholdAccount(authUserId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('remove_household_account', { p_auth_user_id: authUserId });
  if (error) throw error;
  return data === true;
}

// Whether the signed-in account is a Household Account: one that may open Settings.
export async function isHouseholdAccount(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_household_account');
  if (error) throw error;
  return data === true;
}
