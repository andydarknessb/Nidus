import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { browserTimezone } from './timezones';

export type Household = { id: string; name: string; timezone: string };

export function displayNameOf(session: Session): string {
  const meta = session.user.user_metadata as { full_name?: string; name?: string };
  return meta.full_name ?? meta.name ?? session.user.email ?? '';
}

// First sign-in creates the Household and its link; every later call returns
// the existing one. The database owns that rule (ensure_household).
export async function ensureHousehold(session: Session): Promise<Household> {
  const display_name = displayNameOf(session);
  let { error } = await supabase.rpc('ensure_household', { display_name, browser_timezone: browserTimezone() });
  if (error) {
    // A browser timezone the database does not recognise must not block sign-in.
    ({ error } = await supabase.rpc('ensure_household', { display_name, browser_timezone: 'UTC' }));
  }
  if (error) throw error;
  return loadHousehold();
}

export async function loadHousehold(): Promise<Household> {
  const { data, error } = await supabase.from('households').select('id, name, timezone').single<Household>();
  if (error) throw error;
  return data;
}

export async function updateHousehold(id: string, changes: { name: string; timezone: string }): Promise<Household> {
  const { data, error } = await supabase
    .from('households')
    .update(changes)
    .eq('id', id)
    .select('id, name, timezone')
    .single<Household>();
  if (error) throw error;
  return data;
}

export function signInWithGoogle() {
  // Identity only: no calendar scope is requested (ADR 0002).
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
}
