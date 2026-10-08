import type { SupabaseClient } from '@supabase/supabase-js';

// Profiles (CONTEXT.md): a person in the Household, for attribution and
// colour-coding. Every function takes the client so the same code runs in the
// app (the global client) and in tests (a Household Account or a Device,
// against the local stack).

export type Profile = { id: string; name: string; color: string; avatar_url: string | null; sort_order: number };

// What the phone writes for a person: a name and a colour. The picture address left the form in v3 and its column stays, so
// nothing the app does writes it: `avatar_url` is optional, and a write that leaves it out leaves what is stored alone, which
// is what an edit does. Only a test sets it, to have a picture address to leave alone.
export type ProfileInput = { name: string; color: string; avatar_url?: string | null };

// The fixed palette every later feature colours from. Tailwind's 300 shades, the step a
// Profile stores: look.ts takes the other steps of each family from it, and
// tests/look.test.ts holds every pair of words and ground made from them to its
// contrast floor in both modes. `name` is what the picker announces, since colour
// alone never carries the choice.
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

// The letter a person's disc carries: the first character of their name, in capitals.
export function initialOf(name: string): string {
  return [...name.trim()][0]?.toUpperCase() ?? '';
}

// The colour a new person starts on: the one the fewest people have, and the first in the palette among those tied. So it is the
// first colour nobody has (a gap is filled before the end is extended), and once all ten are taken it is the one least shared.
// A colour is compared as the palette writes it, in lower case: one stored in capitals is the same colour, and one that is not in
// the palette is nobody's.
export function firstFreeColor(profiles: readonly { color: string }[]): string {
  const counts = PROFILE_PALETTE.map(({ hex }) => profiles.filter((profile) => profile.color.toLowerCase() === hex).length);
  return PROFILE_PALETTE[counts.indexOf(Math.min(...counts))]!.hex;
}

// Everyone who has this colour, in the order given.
export function colorOwners<T extends { color: string }>(profiles: readonly T[], hex: string): T[] {
  return profiles.filter((profile) => profile.color.toLowerCase() === hex.toLowerCase());
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
