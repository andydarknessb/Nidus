import type { SupabaseClient } from '@supabase/supabase-js';
import { HOME_HOLD_MS } from './routines';

// Shared Lists (CONTEXT.md). Every function takes the client so the same code
// runs in the app (the global client) and in tests (a Household Account or a
// Device, against the local stack).

export type SharedList = { id: string; name: string; sort_order: number };

export type ListItem = { id: string; list_id: string; text: string; crossed_at: string | null; sort_order: number };

const listColumns = 'id, name, sort_order';
const itemColumns = 'id, list_id, text, crossed_at, sort_order';

// ---- Pure helpers -------------------------------------------------------------

// Optimistic cross/uncross: what the screen shows before the server answers.
export function withCrossed(items: ListItem[], id: string, crossed: boolean, now = new Date()): ListItem[] {
  return items.map((item) => (item.id === id ? { ...item, crossed_at: crossed ? now.toISOString() : null } : item));
}

export function withoutCrossed(items: ListItem[]): ListItem[] {
  return items.filter((item) => item.crossed_at === null);
}

// The Lists screen puts the Pinned List first and keeps the others in their order. A list that is no longer
// pinned (none set, or deleted) leaves the order as it is.
export function pinnedFirst(lists: SharedList[], pinnedId: string | null): SharedList[] {
  const pinned = lists.find((list) => list.id === pinnedId);
  return pinned ? [pinned, ...lists.filter((list) => list !== pinned)] : lists;
}

// How many of `count` rows fit in `room` px, the rows being `row` px tall and `gap` px apart: all of them, or as many as
// fit (none, when not even one does). The rows left out are the card's to count and say so.
export function rowsThatFit({ count, room, row, gap }: { count: number; room: number; row: number; gap: number }): number {
  return Math.min(count, Math.max(0, Math.floor((room + gap) / (row + gap))));
}

// From the drawing (v2/home.js): a row on Home is 3 rem (48 px, h-12) and rows are 0.5 rem apart (gap-2). They are rem, like the
// classes they stand for, so a larger text size makes the rows taller and the card counts them taller (`rem`, the root font size).
const HOME_ROW_REM = 3;
const HOME_GAP_REM = 0.5;

// Which of the rows Home's card draws it shows, and how many items still to get it leaves out (what its link says: "3 more"). On a
// tablet the card is measured: `room` px of height, none before it is laid out (then no row shows yet), and the rows are as tall as
// `rem` makes them. On a phone the column has no height to give, so `limit` rows show instead and `room` is not looked at.
export function homeWindow({ rows, limit, room, rem = 16 }: { rows: ListItem[]; limit?: number | undefined; room: number | null; rem?: number }): { shown: number; hidden: number } {
  const shown = limit !== undefined ? Math.min(rows.length, limit) : room === null ? 0 : rowsThatFit({ count: rows.length, room, row: HOME_ROW_REM * rem, gap: HOME_GAP_REM * rem });
  return { shown, hidden: withoutCrossed(rows.slice(shown)).length };
}

// How long, in ms, a row crossed off on Home stays where it is, ticked, so that a second tap can put it back: the one
// hold Home has, which Up next keeps a ticked Routine for too (src/lib/routines.ts).
export { HOME_HOLD_MS };

// The rows Home's card draws, in the list's order: the items still to get, and any crossed off on this card (`crossedHere`: an
// item's id and the time it was crossed off, in ms) less than HOME_HOLD_MS before `now`. Such a row stays where it was, so a tap
// never slides the next row under the finger, and another tap puts it back; each row has its own hold. An item crossed off
// anywhere else is not drawn (it is for the Lists screen until someone clears it), and one deleted elsewhere goes with it.
export function homeRows(items: ListItem[], crossedHere: ReadonlyMap<string, number>, now: number): ListItem[] {
  return items.filter((item) => item.crossed_at === null || now - (crossedHere.get(item.id) ?? -Infinity) < HOME_HOLD_MS);
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

// Writes positions 0..n-1 in the order given, all or nothing: the database
// refuses the whole reorder if any id is not a list the caller may move.
export async function reorderLists(client: SupabaseClient, orderedIds: string[]): Promise<void> {
  const { error } = await client.rpc('reorder_lists', { ids: orderedIds });
  if (error) throw error;
}

// ---- The pinned list (a Household setting) --------------------------------------

export async function loadPinnedListId(client: SupabaseClient): Promise<string | null> {
  const { data, error } = await client.from('households').select('pinned_list_id').single();
  if (error) throw error;
  return (data as { pinned_list_id: string | null }).pinned_list_id;
}

// The pinned list's name, or null when none is pinned.
export async function loadPinnedListName(client: SupabaseClient): Promise<string | null> {
  const id = await loadPinnedListId(client);
  if (id === null) return null;
  const { data, error } = await client.from('shared_lists').select('name').eq('id', id).maybeSingle<{ name: string }>();
  if (error) throw error;
  return data?.name ?? null;
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

// Same all-or-nothing rule as reorderLists, for items.
export async function reorderItems(client: SupabaseClient, orderedIds: string[]): Promise<void> {
  const { error } = await client.rpc('reorder_list_items', { ids: orderedIds });
  if (error) throw error;
}

// The list a phone's Lists screen has open: the one chosen if it is still there, else the Pinned List, else the first. Null with no lists.
export function pickedList(lists: SharedList[], pinnedId: string | null, choice: string | null): string | null {
  return lists.find((list) => list.id === choice)?.id ?? pinnedFirst(lists, pinnedId)[0]?.id ?? null;
}

// What a list's chip is called on the phone, as a screen reader hears it: "Groceries, 4 to get". Until the list's items are read it is the name alone.
export function listChipName(name: string, left: number | null): string {
  return left === null ? name : `${name}, ${left} to get`;
}

// How many are left to get on a list, for its chip and the card's count: null while that is not known, which is until its items are read
// and whenever the last read or write failed (a list that could not be read holds nothing the chip may call "0 to get").
export function leftToGet(loaded: boolean, problem: string, items: ListItem[]): number | null {
  return loaded && !problem ? withoutCrossed(items).length : null;
}
