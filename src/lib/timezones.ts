// The browser's IANA timezone, used once, to seed a new Household. Falls back to
// UTC when the browser reports nothing usable; the database validates the rest.
export function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

// Every IANA zone the browser knows, with the given zone guaranteed present.
export function timezoneOptions(current: string): string[] {
  const zones = Intl.supportedValuesOf('timeZone');
  if (!zones.includes('UTC')) zones.push('UTC');
  if (!zones.includes(current)) zones.push(current);
  return zones.sort();
}
