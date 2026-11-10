import type { SupabaseClient } from '@supabase/supabase-js';

// Usuals (CONTEXT.md): the product the Household buys for an item, by the item's name, with a Target link when there is one. A Household
// Account writes them on the phone's Settings; every principal reads them (the Send to Target message names them, the shopper asks with
// them). The database holds the rules too (migration 20261101000004); the form says the same words first, so the family sees them at once.

export type Usual = { id: string; name: string; product: string; target_link: string | null };
export type UsualInput = { name: string; product: string; target_link: string };
export type UsualField = keyof UsualInput;
export type UsualProblem = { field: UsualField; words: string };

const columns = 'id, name, product, target_link';
export const TARGET_LINK_START = 'https://www.target.com/p/';
const LINK_LIMIT = 500;

export const USUAL_EMPTY = 'No usuals yet. Add the products you always buy.';
export const LINK_WORDS = "Paste a link from Target's app or target.com.";
export const takenWords = (name: string): string => `You already have a usual for ${name.trim()}.`;

// The name as the database compares it: trimmed, runs of spaces as one, ignoring case. "Milk" and "  milk  " are one Usual.
export const usualKey = (name: string): string => name.trim().replace(/\s+/g, ' ').toLowerCase();

// Whether the database refused a Usual because its name is one the Household has (a unique violation, 23505).
export const isTakenName = (error: unknown): boolean => typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';

// The first thing wrong with a Usual's product, link or name, and the field it is about (the name's blank is the form's own line, and is
// left to it). Null when nothing is. `others` are the Household's other Usuals; `ownId` is the Usual being changed, which may keep its name.
export function usualProblem(input: UsualInput, others: readonly Usual[], ownId: string | null): UsualProblem | null {
  const name = input.name.trim();
  if (name === '') return null;
  if (input.product.trim() === '') return { field: 'product', words: 'Say what the product is.' };
  const link = input.target_link.trim();
  if (link !== '' && (!link.startsWith(TARGET_LINK_START) || link.length > LINK_LIMIT)) return { field: 'target_link', words: LINK_WORDS };
  if (others.some((usual) => usual.id !== ownId && usualKey(usual.name) === usualKey(name))) return { field: 'name', words: takenWords(name) };
  return null;
}

export async function loadUsuals(client: SupabaseClient): Promise<Usual[]> {
  const { data, error } = await client.from('usuals').select(columns).order('name');
  if (error) throw error;
  return data as Usual[];
}

// What a Usual stores: trimmed, and no link at all when the field is blank.
const stored = (input: UsualInput) => ({
  name: input.name.trim(),
  product: input.product.trim(),
  target_link: input.target_link.trim() === '' ? null : input.target_link.trim(),
});

export async function createUsual(client: SupabaseClient, householdId: string, input: UsualInput): Promise<void> {
  const { error } = await client.from('usuals').insert({ household_id: householdId, ...stored(input) });
  if (error) throw error;
}

export async function updateUsual(client: SupabaseClient, id: string, input: UsualInput): Promise<void> {
  const { error } = await client.from('usuals').update(stored(input)).eq('id', id);
  if (error) throw error;
}

export async function deleteUsual(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('usuals').delete().eq('id', id);
  if (error) throw error;
}
