import type { Session } from '@supabase/supabase-js';
import type { Appearance } from './mode';
import { keepIfSame } from './same-data';
import { supabase } from './supabase';
import { browserTimezone } from './timezones';
import { capPlace, type TemperatureUnit, type WeatherPlace } from './weather';

export type Household = {
  id: string;
  name: string;
  timezone: string;
  // Where the weather is for and what it is called; all three are null while the weather is off.
  weather_place: string | null;
  latitude: number | null;
  longitude: number | null;
  temperature_unit: TemperatureUnit;
  // How the Household wants the Wall to look; the database refuses any other value.
  appearance: Appearance;
};

// What every read of a Household asks for: one name wrong here and the Wall reads nothing at all.
// Exported so a test can read with exactly this list.
export const householdColumns = 'id, name, timezone, weather_place, latitude, longitude, temperature_unit, appearance';

export function displayNameOf(session: Session): string {
  const meta = session.user.user_metadata as { full_name?: string; name?: string };
  return meta.full_name ?? meta.name ?? session.user.email ?? '';
}

// First sign-in creates the Household and its link; every later call returns
// the existing one. The database owns that rule (ensure_household).
export async function ensureHousehold(session: Session): Promise<Household> {
  const display_name = displayNameOf(session);
  let { error } = await supabase.rpc('ensure_household', { display_name, browser_timezone: browserTimezone() });
  if (error?.code === '23514') {
    // Only a rejected timezone (check_violation) falls back; other errors surface.
    ({ error } = await supabase.rpc('ensure_household', { display_name, browser_timezone: 'UTC' }));
  }
  if (error) throw error;
  return loadHousehold();
}

export async function loadHousehold(): Promise<Household> {
  const { data, error } = await supabase.from('households').select(householdColumns).single<Household>();
  if (error) throw error;
  return data;
}

// What the wall knows of the Household: the last good read, and whether the latest read failed.
export type HouseholdView = { household: Household | null; failed: boolean };

// The wall re-reads the Household on a timer. A failed read never discards a
// Household already read; a successful one replaces it (a changed timezone included).
// A read that finds nothing new gives back the view it was given, and keeps the Household it holds when only a failure ended: every
// read is a new object, and a new view is a new render of the whole Wall, one every 30 seconds for nothing.
export function householdViewAfter(prev: HouseholdView, read: { household: Household } | { failed: true }): HouseholdView {
  if ('failed' in read) return prev.failed ? prev : { household: prev.household, failed: true };
  const household = keepIfSame(prev.household, read.household);
  return !prev.failed && household === prev.household ? prev : { household, failed: false };
}

// Household Account only: a Device reads the Household and the database refuses its write. The Appearance is saved on
// its own, from its own section of the phone's settings.
export async function updateHousehold(id: string, changes: { name: string; timezone: string } | { appearance: Appearance }): Promise<Household> {
  const { data, error } = await supabase
    .from('households')
    .update(changes)
    .eq('id', id)
    .select(householdColumns)
    .single<Household>();
  if (error) throw error;
  return data;
}

// Sets where the weather is for, or null to turn it off, and the unit it shows in. Household
// Account only: a Device reads these columns and the database refuses its write. The place's words
// are cut to what the column holds, and the database keeps the coordinates to two decimals, so the
// Household returned has them rounded.
export async function updateHouseholdWeather(id: string, weather: WeatherPlace | null, unit: TemperatureUnit): Promise<Household> {
  const { data, error } = await supabase
    .from('households')
    .update({
      weather_place: weather ? capPlace(weather.place) : null,
      latitude: weather?.latitude ?? null,
      longitude: weather?.longitude ?? null,
      temperature_unit: unit,
    })
    .eq('id', id)
    .select(householdColumns)
    .single<Household>();
  if (error) throw error;
  return data;
}

// Signing in comes back to `returnTo`, a path on this site: Settings unless a page (the join page) has somewhere of its own.
export function signInWithGoogle(returnTo = '/settings') {
  // Identity only: no calendar scope is requested (ADR 0002).
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}${returnTo}` },
  });
}
