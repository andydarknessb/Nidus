import type { SupabaseClient } from '@supabase/supabase-js';

// Calendar Accounts and Mirrored Calendars (CONTEXT.md). Every function takes the
// client so the same code runs in the app and in tests against the local stack.
// The Household Account chooses and removes; a Device only reads. The Google
// connection itself is the calendar-connect Edge Function; the refresh token never
// reaches a client, and neither does the column that names its Vault secret.

export type CalendarAccountStatus = 'active' | 'needs_reauth' | 'error';

export type CalendarAccount = {
  id: string;
  google_email: string;
  status: CalendarAccountStatus;
  last_synced_at: string | null;
  last_error: string | null;
};

export type MirroredCalendar = {
  id: string;
  calendar_account_id: string;
  google_calendar_id: string;
  name: string;
  // Optional colour override; null means the calendar shows in its Profile's colour.
  color: string | null;
  // Null means the whole Household.
  profile_id: string | null;
  selected: boolean;
};

export type MirroredCalendarChoice = { selected: boolean; profile_id: string | null; color: string | null };

// Explicit column lists: `select *` on these tables is refused, because vault_secret_id
// and sync_token are not granted to clients.
const accountColumns = 'id, google_email, status, last_synced_at, last_error';
const calendarColumns = 'id, calendar_account_id, google_calendar_id, name, color, profile_id, selected';

export async function loadCalendarAccounts(client: SupabaseClient): Promise<CalendarAccount[]> {
  const { data, error } = await client.from('calendar_accounts').select(accountColumns).order('created_at');
  if (error) throw error;
  return data as CalendarAccount[];
}

export async function loadMirroredCalendars(client: SupabaseClient): Promise<MirroredCalendar[]> {
  const { data, error } = await client.from('mirrored_calendars').select(calendarColumns).order('name');
  if (error) throw error;
  return data as MirroredCalendar[];
}

// The URL to send the browser to: Google's consent screen for the parent's own
// account ('settings'), or a link to hand to another adult ('link').
export async function startCalendarConnect(client: SupabaseClient, kind: 'settings' | 'link'): Promise<string> {
  const { data, error } = await client.functions.invoke<{ url: string }>('calendar-connect/start', { body: { kind } });
  if (error || !data?.url) throw error ?? new Error('calendar-connect returned no url');
  return data.url;
}

export async function updateMirroredCalendar(
  client: SupabaseClient,
  id: string,
  choice: MirroredCalendarChoice,
): Promise<void> {
  const { error } = await client.from('mirrored_calendars').update(choice).eq('id', id);
  if (error) throw error;
}

// Deletes the account; the database drops its Vault secret and its Mirrored Calendars with it.
export async function removeCalendarAccount(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('calendar_accounts').delete().eq('id', id);
  if (error) throw error;
}

// The account's calendars, selected ones first, the way the screen lists them.
export function calendarsOfAccount(calendars: MirroredCalendar[], accountId: string): MirroredCalendar[] {
  return calendars
    .filter((calendar) => calendar.calendar_account_id === accountId)
    .sort((a, b) => Number(b.selected) - Number(a.selected) || a.name.localeCompare(b.name));
}
