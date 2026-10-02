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
    const city = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1).replaceAll('_', ' ') : '';
    if (called !== undefined) name = city === '' ? called : `${called} (${city})`;
  } catch {
    // Not a zone the browser knows (a RangeError): it stays as stored.
  }
  names.set(id, name);
  return name;
}

export type TimezoneOption = { id: string; name: string };

// Every IANA zone the browser knows, in the order of their names, with the given zone guaranteed present and UTC always there.
export function timezoneOptions(current: string): TimezoneOption[] {
  const ids = Intl.supportedValuesOf('timeZone');
  if (!ids.includes('UTC')) ids.push('UTC');
  if (!ids.includes(current)) ids.push(current);
  return ids.map((id) => ({ id, name: timezoneName(id) })).sort((a, b) => a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id, 'en'));
}
