import type { SupabaseClient } from '@supabase/supabase-js';

// List Suggestions (CONTEXT.md; spec 0019): what the shopper suggests for a Shared List, waiting on it until someone adds or dismisses
// it. A suggestion is not an item: nothing counts, notifies, sends or clears it until it is added. The client is passed in, as in
// shared-lists.ts, so the same code runs in the app and in tests.

export type ListSuggestion = { id: string; list_id: string; text: string; for_meals: string | null; sort_order: number };

const suggestionColumns = 'id, list_id, text, for_meals, sort_order';

// The list's suggestions, in the order the shopper gave them.
export async function loadSuggestions(client: SupabaseClient, listId: string): Promise<ListSuggestion[]> {
  const { data, error } = await client
    .from('list_suggestions')
    .select(suggestionColumns)
    .eq('list_id', listId)
    .order('sort_order')
    .order('created_at');
  if (error) throw error;
  return data as ListSuggestion[];
}

// Adds them as items, after the list's last item and in the suggestions' order, in one request. One a person has already added or
// dismissed is not there any more, so it adds nothing.
export async function addSuggestions(client: SupabaseClient, ids: string[]): Promise<void> {
  const { error } = await client.rpc('add_list_suggestions', { p_ids: ids });
  if (error) throw error;
}

// Dismisses exactly these, so a suggestion the shopper leaves after the card was read is not dismissed with them.
export async function dismissSuggestions(client: SupabaseClient, ids: string[]): Promise<void> {
  const { error } = await client.from('list_suggestions').delete().in('id', ids);
  if (error) throw error;
}
