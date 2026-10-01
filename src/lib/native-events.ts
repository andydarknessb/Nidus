import type { SupabaseClient } from '@supabase/supabase-js';

// Native Events (CONTEXT.md): created in Nidus, living only in Nidus. A Household Account (the
// phone) or a Device (the wall) writes them. Every function takes the client so the same code
// runs in the app and in tests, against the local stack.

export type NativeEventInput = {
  title: string;
  location: string | null;
  notes: string | null;
  // ISO instants. For an all-day event, Household-Timezone midnights, the end being the
  // midnight after its last day.
  starts_at: string;
  ends_at: string;
  is_all_day: boolean;
  // Zero means the whole Household.
  profile_ids: string[];
};

// A blank optional field means none.
export function cleanOptional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

// Creates the event (no `id`) or edits it, with its Profiles, in one transaction. Returns its id.
export async function saveNativeEvent(client: SupabaseClient, input: NativeEventInput, id?: string): Promise<string> {
  const { data, error } = await client.rpc('save_native_event', {
    p_id: id ?? null,
    p_title: input.title.trim(),
    p_location: input.location,
    p_notes: input.notes,
    p_starts_at: input.starts_at,
    p_ends_at: input.ends_at,
    p_is_all_day: input.is_all_day,
    p_profile_ids: input.profile_ids,
  });
  if (error) throw error;
  return data as string;
}

// Its Profile rows go with it.
export async function deleteNativeEvent(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('native_events').delete().eq('id', id);
  if (error) throw error;
}
