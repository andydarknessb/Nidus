import type { SupabaseClient } from '@supabase/supabase-js';

// Shared Lists (CONTEXT.md). Every function takes the client so the same code
// runs in the app (the global client) and in tests (a Household Account or a
// Device, against the local stack).

export type SharedList = { id: string; name: string; sort_order: number };

export type ListItem = { id: string; list_id: string; text: string; crossed_at: string | null; sort_order: number };

const listColumns = 'id, name, sort_order';
const itemColumns = 'id, list_id, text, crossed_at, sort_order';

// ---- Pure helpers -------------------------------------------------------------

// Order the way the rail shows it: by position (the server breaks ties by age).
export function byPosition<T extends { sort_order: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.sort_order - b.sort_order);
}

// New rows go to the bottom.
export function nextSortOrder(rows: { sort_order: number }[]): number {
  return rows.reduce((max, row) => Math.max(max, row.sort_order), -1) + 1;
}

// The ids in their new order after moving `id` by `offset` places (clamped to the ends).
export function movedIds(ids: string[], id: string, offset: number): string[] {
  const from = ids.indexOf(id);
  if (from < 0) return ids;
  const to = Math.min(Math.max(from + offset, 0), ids.length - 1);
  const next = ids.filter((existing) => existing !== id);
  next.splice(to, 0, id);
  return next;
}

// Optimistic cross/uncross: what the screen shows before the server answers.
export function withCrossed(items: ListItem[], id: string, crossed: boolean, now = new Date()): ListItem[] {
  return items.map((item) => (item.id === id ? { ...item, crossed_at: crossed ? now.toISOString() : null } : item));
}

export function withoutCrossed(items: ListItem[]): ListItem[] {
  return items.filter((item) => item.crossed_at === null);
}

// ---- Lists (Household Account writes) ------------------------------------------

export async function loadLists(client: SupabaseClient): Promise<SharedList[]> {
  const { data, error } = await client.from('shared_lists').select(listColumns).order('sort_order').order('created_at');
  if (error) throw error;
  return data as SharedList[];
}

export async function createList(client: SupabaseClient, householdId: string, name: string, sortOrder: number): Promise<SharedList> {
  const { data, error } = await client
    .from('shared_lists')
    .insert({ household_id: householdId, name: name.trim(), sort_order: sortOrder })
    .select(listColumns)
    .single();
  if (error) throw error;
  return data as SharedList;
}

export async function renameList(client: SupabaseClient, id: string, name: string): Promise<void> {
  const { error } = await client.from('shared_lists').update({ name: name.trim() }).eq('id', id);
  if (error) throw error;
}

export async function deleteList(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('shared_lists').delete().eq('id', id);
  if (error) throw error;
}

// Writes positions 0..n-1 in the order given.
export async function reorderLists(client: SupabaseClient, orderedIds: string[]): Promise<void> {
  const results = await Promise.all(
    orderedIds.map((id, index) => client.from('shared_lists').update({ sort_order: index }).eq('id', id)),
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;
}

// ---- The pinned list (a Household setting) --------------------------------------

export async function loadPinnedListId(client: SupabaseClient): Promise<string | null> {
  const { data, error } = await client.from('households').select('pinned_list_id').single();
  if (error) throw error;
  return (data as { pinned_list_id: string | null }).pinned_list_id;
}

export async function setPinnedList(client: SupabaseClient, householdId: string, listId: string): Promise<void> {
  const { error } = await client.from('households').update({ pinned_list_id: listId }).eq('id', householdId);
  if (error) throw error;
}

// ---- Items (Household Account or Device) ----------------------------------------

export async function loadItems(client: SupabaseClient, listId: string): Promise<ListItem[]> {
  const { data, error } = await client
    .from('list_items')
    .select(itemColumns)
    .eq('list_id', listId)
    .order('sort_order')
    .order('created_at');
  if (error) throw error;
  return data as ListItem[];
}

export async function addItem(client: SupabaseClient, listId: string, text: string, sortOrder: number): Promise<ListItem> {
  const { data, error } = await client
    .from('list_items')
    .insert({ list_id: listId, text: text.trim(), sort_order: sortOrder })
    .select(itemColumns)
    .single();
  if (error) throw error;
  return data as ListItem;
}

export async function setCrossed(client: SupabaseClient, id: string, crossed: boolean): Promise<void> {
  const { error } = await client
    .from('list_items')
    .update({ crossed_at: crossed ? new Date().toISOString() : null })
    .eq('id', id);
  if (error) throw error;
}

// "Clear completed": deletes the crossed items of one list, leaves the open ones.
export async function clearCompleted(client: SupabaseClient, listId: string): Promise<void> {
  const { error } = await client.from('list_items').delete().eq('list_id', listId).not('crossed_at', 'is', null);
  if (error) throw error;
}

export async function reorderItems(client: SupabaseClient, orderedIds: string[]): Promise<void> {
  const results = await Promise.all(
    orderedIds.map((id, index) => client.from('list_items').update({ sort_order: index }).eq('id', id)),
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;
}

// ---- Optimistic updates ----------------------------------------------------------

type Publish = (update: (current: ListItem[]) => ListItem[]) => void;

// Shows the cross (or uncross) at once, then asks the server. If the server says
// no, only that item goes back to what it was; other changes made meanwhile stay.
// `before` is the rows as they were when the tap happened. Returns whether it stuck.
export async function crossOptimistically(
  publish: Publish,
  id: string,
  crossed: boolean,
  before: ListItem[],
  write: () => Promise<void>,
): Promise<boolean> {
  const previous = before.find((item) => item.id === id)?.crossed_at ?? null;
  publish((current) => withCrossed(current, id, crossed));
  try {
    await write();
    return true;
  } catch {
    publish((current) => current.map((item) => (item.id === id ? { ...item, crossed_at: previous } : item)));
    return false;
  }
}

// Same for "clear completed": the crossed items vanish at once and come back in
// their places if the delete fails.
export async function clearOptimistically(publish: Publish, before: ListItem[], write: () => Promise<void>): Promise<boolean> {
  const removed = before.filter((item) => item.crossed_at !== null);
  publish((current) => withoutCrossed(current));
  try {
    await write();
    return true;
  } catch {
    publish((current) => byPosition([...current, ...removed]));
    return false;
  }
}
