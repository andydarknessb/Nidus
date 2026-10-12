import type { Session, SupabaseClient } from '@supabase/supabase-js';

export type PairingCode = { code: string; expiresAt: Date };

export type Device = { id: string; name: string; paired_at: string; last_seen_at: string | null };

// A tablet holds an anonymous Supabase session; a Household Account never does.
export function isDeviceSession(session: Session): boolean {
  return session.user.is_anonymous === true;
}

// Tablet side: asks for a fresh Pairing Code, replacing any earlier one.
export async function requestPairingCode(client: SupabaseClient): Promise<PairingCode> {
  const { data, error } = await client.rpc('create_pairing_request').single<{ code: string; expires_at: string }>();
  if (error) throw error;
  return { code: data.code, expiresAt: new Date(data.expires_at) };
}

// Tablet side: the heartbeat. True while this session is a paired Device, false
// once it was never paired or has been revoked.
export async function touchDevice(client: SupabaseClient): Promise<boolean> {
  const { data, error } = await client.rpc('touch_device');
  if (error) throw error;
  return data === true;
}

const INVALID_CODE = '22023';
const TOO_MANY_ATTEMPTS = 'P0429';

// Phone side. The database answers null for an unknown, expired or used code
// (so the failure it counts can commit) and raises P0429 once this account has
// failed too often.
export async function claimPairingCode(client: SupabaseClient, code: string, name: string): Promise<void> {
  const { data, error } = await client.rpc('claim_pairing_code', { pairing_code: code, device_name: name.trim() });
  if (error) throw error;
  if (data === null) {
    throw Object.assign(new Error('That code is not valid. It may have expired or already been used.'), {
      code: INVALID_CODE,
    });
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null ? (error as { code?: string }).code : undefined;
}

export function isInvalidCode(error: unknown): boolean {
  return errorCode(error) === INVALID_CODE;
}

export function isTooManyAttempts(error: unknown): boolean {
  return errorCode(error) === TOO_MANY_ATTEMPTS;
}

export async function listDevices(client: SupabaseClient): Promise<Device[]> {
  const { data, error } = await client
    .from('devices')
    .select('id, name, paired_at, last_seen_at')
    .order('paired_at')
    .returns<Device[]>();
  if (error) throw error;
  return data;
}

export async function revokeDevice(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('devices').delete().eq('id', id);
  if (error) throw error;
}

