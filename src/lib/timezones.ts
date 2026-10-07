// The browser's IANA timezone, used once, to seed a new Household. Falls back to
// UTC when the browser reports nothing usable; the database validates the rest.
export function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

// A zone's names do not change with the day, but a zone's rules once did: one fixed day, so the same name comes out everywhere.
const NAMED_ON = new Date('2026-01-01T12:00:00Z');

function nameStyle(id: string, style: 'longGeneric' | 'long'): string | undefined {
  return new Intl.DateTimeFormat('en-US', { timeZone: id, timeZoneName: style }).formatToParts(NAMED_ON).find((part) => part.type === 'timeZoneName')?.value;
}

const names = new Map<string, string>();

// The zone an id stands for, as the browser spells it: `US/Central` and `America/Chicago` are one zone, and so are `Asia/Kolkata` and
// `Asia/Calcutta`, whichever of the two the browser keeps. An id the browser does not know stands for itself.
function canonical(id: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: id }).resolvedOptions().timeZone;
  } catch {
    return id;
  }
}

// Where an id is: the part after its area ("Chicago" of "America/Chicago"). An old name whose area is not a place (`US/Central`,
// `Canada/Eastern`) names no city, so it is the city of the zone it stands for.
const AREAS = new Set(['Africa', 'America', 'Antarctica', 'Arctic', 'Asia', 'Atlantic', 'Australia', 'Europe', 'Indian', 'Pacific']);
function cityOf(id: string): string {
  if (!id.includes('/')) return '';
  const place = AREAS.has(id.slice(0, id.indexOf('/'))) ? id : canonical(id);
  return AREAS.has(place.slice(0, Math.max(0, place.indexOf('/')))) ? place.slice(place.lastIndexOf('/') + 1).replaceAll('_', ' ') : '';
}

// A zone as a family reads it: what it is called, then the city it is named for. "Central Time (Chicago)", not
// "America/Chicago". UTC has no city and is "Coordinated Universal Time". A zone the browser cannot name is shown as it is
// stored. The stored value is always the IANA id: this is only what is drawn.
export function timezoneName(id: string): string {
  const known = names.get(id);
  if (known !== undefined) return known;
  let name = id;
  try {
    // The generic name ("Central Time") holds the year round; a zone that only has an offset for one ("GMT+00:00") says more in full.
    const generic = nameStyle(id, 'longGeneric');
    const called = generic !== undefined && /^GMT[+-]/.test(generic) ? nameStyle(id, 'long') : generic;
    const city = cityOf(id);
    if (called !== undefined) name = city === '' ? called : `${called} (${city})`;
  } catch {
    // Not a zone the browser knows (a RangeError): it stays as stored.
  }
  names.set(id, name);
  return name;
}

export type TimezoneOption = { id: string; name: string };

// Every IANA zone the browser knows, in the order of their names, with the given zone guaranteed present and UTC always there. A zone
// is listed once: the stored zone is the one listed for it, so `US/Central` replaces `America/Chicago` and `Asia/Kolkata` replaces the
// browser's `Asia/Calcutta`, and the selection shows what is stored.
export function timezoneOptions(current: string): TimezoneOption[] {
  const ids = Intl.supportedValuesOf('timeZone');
  if (!ids.includes('UTC')) ids.push('UTC');
  const listed = new Map<string, string>();
  for (const id of ids) listed.set(canonical(id), id);
  listed.set(canonical(current), current);
  return [...listed.values()].map((id) => ({ id, name: timezoneName(id) })).sort((a, b) => a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id, 'en'));
}
