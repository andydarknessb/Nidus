import type { SupabaseClient } from '@supabase/supabase-js';

// Profiles (CONTEXT.md): a person in the Household, for attribution and
// colour-coding. Every function takes the client so the same code runs in the
// app (the global client) and in tests (a Household Account or a Device,
// against the local stack).

export type Profile = { id: string; name: string; color: string; avatar_url: string | null; sort_order: number };

export type ProfileInput = { name: string; color: string; avatar_url: string | null };

// The fixed palette every later feature colours from. Tailwind's 300 shades: each
// clears WCAG AAA (7:1) against Zinc-950 (#09090b), the app background; the tests
// hold that line. `name` is what the picker announces, since colour alone never
// carries the choice.
export const PROFILE_BACKGROUND = '#09090b';

export const PROFILE_PALETTE = [
  { name: 'Red', hex: '#fca5a5' },
  { name: 'Orange', hex: '#fdba74' },
  { name: 'Amber', hex: '#fcd34d' },
  { name: 'Lime', hex: '#bef264' },
  { name: 'Emerald', hex: '#6ee7b7' },
  { name: 'Cyan', hex: '#67e8f9' },
  { name: 'Sky', hex: '#7dd3fc' },
  { name: 'Blue', hex: '#93c5fd' },
  { name: 'Violet', hex: '#c4b5fd' },
  { name: 'Pink', hex: '#f9a8d4' },
] as const;

const columns = 'id, name, color, avatar_url, sort_order';

// ---- Pure helpers -------------------------------------------------------------

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

// WCAG 2.x contrast ratio between two #rrggbb colours (1 to 21).
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

export function paletteColorName(hex: string): string | undefined {
  return PROFILE_PALETTE.find((color) => color.hex === hex)?.name;
}

// Order the way the screen shows it: by position.
export function byPosition<T extends { sort_order: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.sort_order - b.sort_order);
}

// New Profiles go to the bottom.
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

// A blank avatar field means no avatar.
export function cleanAvatarUrl(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

// ---- Household Account writes; Household Account or Device reads ----------------

export async function loadProfiles(client: SupabaseClient): Promise<Profile[]> {
  const { data, error } = await client.from('profiles').select(columns).order('sort_order').order('created_at');
  if (error) throw error;
  return data as Profile[];
}

export async function createProfile(
  client: SupabaseClient,
  householdId: string,
  input: ProfileInput,
  sortOrder: number,
): Promise<Profile> {
  const { data, error } = await client
    .from('profiles')
    .insert({ household_id: householdId, ...input, name: input.name.trim(), sort_order: sortOrder })
    .select(columns)
    .single();
  if (error) throw error;
  return data as Profile;
}

export async function updateProfile(client: SupabaseClient, id: string, input: ProfileInput): Promise<void> {
  const { error } = await client
    .from('profiles')
    .update({ ...input, name: input.name.trim() })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteProfile(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('profiles').delete().eq('id', id);
  if (error) throw error;
}

// Writes positions 0..n-1 in the order given, all or nothing: the database
// refuses the whole reorder if any id is not a Profile the caller may move.
export async function reorderProfiles(client: SupabaseClient, orderedIds: string[]): Promise<void> {
  const { error } = await client.rpc('reorder_profiles', { ids: orderedIds });
  if (error) throw error;
}
