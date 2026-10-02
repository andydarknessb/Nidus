import { readFileSync } from 'node:fs';
import { Fragment, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AccountSummary as AccountSummaryType, CalendarRow as CalendarRowType } from '../src/CalendarAccountsSection';
import type { CalendarsPage as CalendarsPageType } from '../src/CalendarsPage';
import type { SettingsPage as SettingsPageType } from '../src/SettingsPage';
import { ColorPicker, DELETE_PERSON_WORDS, DeletePerson, PersonFields } from '../src/components/PersonEditor';
import { UPDATE_FAILED_WORDS, accountStatusText } from '../src/lib/calendar-accounts';
import { seenWords } from '../src/lib/device-format';
import type { Household } from '../src/lib/household';
import { TOKENS } from '../src/lib/look';
import { PROFILE_PALETTE, colorOwners, eventPeople, firstFreeColor, namesInWords } from '../src/lib/profiles';
import { SETTINGS_TABS, settingsLabelOf, settingsPathNow, settingsTabOf } from '../src/lib/settings-tabs';
import { timezoneName, timezoneOptions } from '../src/lib/timezones';

// The phone's settings (spec 0003, Phone settings and People): what is pure about them. The first free colour, the time zone
// names, the tabs and where each page lives, the words for an account that failed and for a tablet last seen, and the parts the
// People card is made of, rendered to markup so that what is asserted is what the browser is given. What the database does with
// a Profile's picture address is in tests/profiles.test.ts, which needs the local stack.

const hexes = PROFILE_PALETTE.map((color) => color.hex);
const hex = (index: number) => hexes[index]!;
const people = (...colors: string[]) => colors.map((color) => ({ color }));

describe('the colour a new person starts on', () => {
  it('is the first colour of the palette when nobody has any', () => {
    expect(firstFreeColor([])).toBe(hex(0));
  });

  it('is the first colour nobody has, so a gap is filled before the end is extended', () => {
    expect(firstFreeColor(people(hex(0), hex(1)))).toBe(hex(2));
    expect(firstFreeColor(people(hex(1)))).toBe(hex(0));
    expect(firstFreeColor(people(hex(0), hex(2), hex(3)))).toBe(hex(1));
    expect(firstFreeColor(people(...hexes.slice(0, 9)))).toBe(hex(9));
  });

  it('is the one the fewest people have once all ten are taken, palette order breaking ties', () => {
    const everyone = people(...hexes);
    // Ten people, one colour each: all tied, so the first.
    expect(firstFreeColor(everyone)).toBe(hex(0));
    // The first is twice taken: the next of the ties.
    expect(firstFreeColor([...everyone, ...people(hex(0))])).toBe(hex(1));
    expect(firstFreeColor([...everyone, ...people(hex(0), hex(1), hex(2))])).toBe(hex(3));
    // Wherever the least shared one is, it is the one: every colour twice but the ninth.
    expect(firstFreeColor([...everyone, ...people(...hexes.filter((_, index) => index !== 8))])).toBe(hex(8));
    // Two people on one colour and one on every other: the first of those on one.
    expect(firstFreeColor([...everyone, ...people(hex(0), hex(0))])).toBe(hex(1));
  });

  it('counts a colour stored in capitals as the same colour', () => {
    expect(firstFreeColor(people(hex(0).toUpperCase()))).toBe(hex(1));
    expect(firstFreeColor([...people(...hexes.map((color) => color.toUpperCase())), ...people(hex(0))])).toBe(hex(1));
  });

  it('does not count a colour that is not in the palette', () => {
    expect(firstFreeColor(people('#123456', '#fe0000'))).toBe(hex(0));
  });

  it('is always one of the ten', () => {
    for (let count = 0; count <= 25; count += 1) {
      const everyone = Array.from({ length: count }, (_, index) => ({ color: hex(index % 10) }));
      expect(hexes, `${count} people`).toContain(firstFreeColor(everyone));
    }
  });
});

describe('whose a colour is', () => {
  const cory = { id: 'p1', name: 'Cory', color: hex(7) };
  const sam = { id: 'p2', name: 'Sam', color: hex(9) };
  const alex = { id: 'p3', name: 'Alex', color: hex(7).toUpperCase() };

  it('lists the people who have it, in their order', () => {
    expect(colorOwners([cory, sam, alex], hex(7))).toEqual([cory, alex]);
    expect(colorOwners([cory, sam], hex(0))).toEqual([]);
  });

  it('names people for a sentence', () => {
    expect(namesInWords([])).toBe('');
    expect(namesInWords(['Cory'])).toBe('Cory');
    expect(namesInWords(['Cory', 'Sam'])).toBe('Cory and Sam');
    expect(namesInWords(['Cory', 'Sam', 'Ava'])).toBe('Cory, Sam and Ava');
  });
});

describe('who an event is for', () => {
  const [cory, sam, ava] = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }];

  it('is everyone when it names nobody', () => {
    expect(eventPeople([], [cory, sam, ava])).toEqual({ everyone: true, people: [] });
  });

  it('is the people it names, in the order of the people and not of the event', () => {
    expect(eventPeople(['p3', 'p1'], [cory, sam, ava])).toEqual({ everyone: false, people: [cory, ava] });
  });

  it('is everyone when it names every person of a Household of two or more', () => {
    expect(eventPeople(['p2', 'p1', 'p3'], [cory, sam, ava])).toEqual({ everyone: true, people: [] });
    expect(eventPeople(['p1', 'p2'], [cory, sam])).toEqual({ everyone: true, people: [] });
  });

  it('is that person when it names the only person of a Household', () => {
    expect(eventPeople(['p1'], [cory])).toEqual({ everyone: false, people: [cory] });
  });

  it('is nobody drawn, and not everyone, while the people are not read yet', () => {
    expect(eventPeople(['p1'], [])).toEqual({ everyone: false, people: [] });
  });
});

describe('time zones, listed by name', () => {
  it('say what the zone is called and the city it is named for', () => {
    expect(timezoneName('America/Chicago')).toBe('Central Time (Chicago)');
    expect(timezoneName('America/New_York')).toBe('Eastern Time (New York)');
    expect(timezoneName('America/Denver')).toBe('Mountain Time (Denver)');
    expect(timezoneName('America/Los_Angeles')).toBe('Pacific Time (Los Angeles)');
  });

  it('take the city from the last part of the id, with its underscores as spaces', () => {
    expect(timezoneName('America/Argentina/Buenos_Aires')).toMatch(/\(Buenos Aires\)$/);
    expect(timezoneName('America/Indiana/Indianapolis')).toMatch(/\(Indianapolis\)$/);
  });

  it('call UTC by its name, which has no city', () => {
    expect(timezoneName('UTC')).toBe('Coordinated Universal Time');
  });

  it('give a zone the browser does not know as it was stored', () => {
    expect(timezoneName('Mars/Olympus_Mons')).toBe('Mars/Olympus_Mons');
  });

  it('are listed with the stored value still the IANA id', () => {
    const options = timezoneOptions('America/Chicago');
    expect(options.find((option) => option.name === 'Central Time (Chicago)')).toEqual({ id: 'America/Chicago', name: 'Central Time (Chicago)' });
    expect(options.find((option) => option.id === 'UTC')?.name).toBe('Coordinated Universal Time');
    for (const { id, name } of options) {
      expect(id, name).toMatch(/^(UTC|[A-Za-z_]+(\/[A-Za-z_+-]+)+)$/);
      if (id.includes('/')) expect(name.endsWith(`(${id.slice(id.lastIndexOf('/') + 1).replaceAll('_', ' ')})`), `${id}: ${name}`).toBe(true);
    }
  });

  it('are in the order of their names, each zone once', () => {
    const options = timezoneOptions('America/Chicago');
    const names = options.map((option) => option.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en') || 0));
    expect(new Set(options.map((option) => option.id)).size).toBe(options.length);
  });

  it('always hold the Household\'s own zone, even one the browser does not list', () => {
    expect(timezoneOptions('Mars/Olympus_Mons')).toContainEqual({ id: 'Mars/Olympus_Mons', name: 'Mars/Olympus_Mons' });
    expect(timezoneOptions('America/Chicago').filter((option) => option.id === 'America/Chicago')).toHaveLength(1);
  });
});

describe('the phone\'s pages', () => {
  it('are Household, Calendars, Routines and Lists, in that order, each at its own address', () => {
    expect(SETTINGS_TABS.map(({ label, path }) => [label, path])).toEqual([
      ['Household', '/settings'],
      ['Calendars', '/settings/calendars'],
      ['Routines', '/settings/routines'],
      ['Lists', '/settings/lists'],
    ]);
  });

  it("are called by the word on their tab, which is also the page in the document's title", () => {
    for (const { tab, label } of SETTINGS_TABS) expect(settingsLabelOf(tab), tab).toBe(label);
  });

  it('are told from the path, each tab current at its own address', () => {
    for (const { tab, path } of SETTINGS_TABS) {
      expect(settingsTabOf(path), path).toBe(tab);
      expect(settingsTabOf(`${path}/`), `${path}/`).toBe(tab);
    }
  });

  it('take /settings/events to the Calendars page, and the address with it', () => {
    expect(settingsTabOf('/settings/events')).toBe('calendars');
    expect(settingsPathNow('/settings/events')).toBe('/settings/calendars');
    expect(settingsPathNow('/settings/events/')).toBe('/settings/calendars/');
    for (const { path } of SETTINGS_TABS) expect(settingsPathNow(path), path).toBe(path);
  });

  it('treat any other address under /settings as Household, as the phone always has', () => {
    expect(settingsTabOf('/settings/nonsense')).toBe('household');
    expect(settingsTabOf('/settings/eventsfoo')).toBe('household');
    expect(settingsPathNow('/settings/eventsfoo')).toBe('/settings/eventsfoo');
  });
});

describe('what a Calendar Account says of itself', () => {
  it('says Connected when its last update went through', () => {
    expect(accountStatusText({ status: 'active', last_error: null })).toBe('Connected');
  });

  it('says that the last update failed, and that Nidus tries again every 5 minutes, and nothing of what Google said', () => {
    const words = accountStatusText({ status: 'active', last_error: 'Family: Google answered 500; Sam: could not reach Google' });
    expect(words).toBe('Connected, but the last update failed. Nidus tries again every 5 minutes.');
    expect(words).toBe(UPDATE_FAILED_WORDS);
    expect(words).not.toMatch(/Google|500|Family|Sam/);
  });

  it('says it has to be connected again when Google no longer trusts it, whatever went wrong before', () => {
    expect(accountStatusText({ status: 'needs_reauth', last_error: null })).toBe('Needs to be connected again');
    expect(accountStatusText({ status: 'needs_reauth', last_error: 'invalid_grant' })).toBe('Needs to be connected again');
  });
});

describe('when a tablet was last seen', () => {
  const now = new Date('2026-10-01T19:21:00Z');
  const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000).toISOString();

  it('says Seen, and how long ago, in words', () => {
    expect(seenWords(ago(2 * 60), now)).toBe('Seen 2 minutes ago');
    expect(seenWords(ago(60 * 60), now)).toBe('Seen 1 hour ago');
    expect(seenWords(ago(3 * 24 * 3600), now)).toBe('Seen 3 days ago');
  });

  it('says Seen just now for a tablet that has only just been', () => {
    expect(seenWords(ago(10), now)).toBe('Seen just now');
  });

  it('says Not seen yet for a tablet that never has been', () => {
    expect(seenWords(null, now)).toBe('Not seen yet');
  });
});

// The markup of a part, with its tags gone and the entities React writes read back.
const words = (markup: string) =>
  markup
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

describe('the colours a person can be given', () => {
  const cory = { id: 'p1', name: 'Cory', color: hex(7), avatar_url: null, sort_order: 0 };
  const sam = { id: 'p2', name: 'Sam', color: hex(9), avatar_url: null, sort_order: 1 };
  const render = (props: Partial<Parameters<typeof ColorPicker>[0]> = {}) =>
    renderToStaticMarkup(createElement(ColorPicker, { value: hex(0), profiles: [cory, sam], onChange: () => undefined, ...props }));
  const radios = (markup: string) =>
    [...markup.matchAll(/<label[^>]*>\s*<input([^>]*)\/?>([\s\S]*?)<\/label>/g)].map(([, attributes, rest]) => ({
      name: /aria-label="([^"]*)"/.exec(attributes ?? '')?.[1] ?? '',
      value: /value="([^"]*)"/.exec(attributes ?? '')?.[1] ?? '',
      checked: /\bchecked(=|\s|\/|>)/.test(attributes ?? ''),
      disabled: /\bdisabled(=|\s|\/|>)/.test(attributes ?? ''),
      shown: words(rest ?? ''),
    }));

  it('offers all ten, named, in the palette\'s order, with the one chosen checked', () => {
    const found = radios(render({ value: hex(3) }));
    expect(found.map((radio) => radio.value)).toEqual(hexes);
    expect(found.filter((radio) => radio.checked).map((radio) => radio.value)).toEqual([hex(3)]);
    expect(found[0]?.name).toBe('Red');
    expect(found[3]?.name).toBe('Lime');
  });

  it('shows whose a colour is, by their initial on it and in its name', () => {
    const found = radios(render());
    expect(found[7]).toMatchObject({ name: 'Blue, in use by Cory', shown: 'C' });
    expect(found[9]).toMatchObject({ name: 'Pink, in use by Sam', shown: 'S' });
    expect(found[0]).toMatchObject({ name: 'Red', shown: '' });
  });

  it('lets a colour in use be chosen all the same', () => {
    const found = radios(render({ value: hex(7) }));
    expect(found.some((radio) => radio.disabled)).toBe(false);
    expect(found[7]?.checked).toBe(true);
    expect(radios(render({ value: hex(9) }))[9]?.checked).toBe(true);
  });

  it('shows everyone who has a colour that more than one has', () => {
    const alex = { id: 'p3', name: 'Alex', color: hex(7), avatar_url: null, sort_order: 2 };
    const ben = { id: 'p4', name: 'Ben', color: hex(7), avatar_url: null, sort_order: 3 };
    expect(radios(render({ profiles: [cory, alex] }))[7]).toMatchObject({ name: 'Blue, in use by Cory and Alex', shown: 'CA' });
    expect(radios(render({ profiles: [cory, alex, ben] }))[7]).toMatchObject({ name: 'Blue, in use by Cory, Alex and Ben' });
  });

  it('says what the letters are only when there are any', () => {
    expect(words(render())).toContain('A letter marks a colour someone already has.');
    expect(words(render({ profiles: [] }))).not.toContain('A letter marks');
  });

  it('is one group of radios, and a form to add and a form to edit open together do not share it', () => {
    const together = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        createElement(ColorPicker, { value: hex(0), profiles: [cory], onChange: () => undefined }),
        createElement(ColorPicker, { value: hex(1), profiles: [cory], onChange: () => undefined }),
      ),
    );
    const groups = [...together.matchAll(/<input[^>]*\bname="([^"]*)"/g)].map(([, name]) => name);
    expect(groups).toHaveLength(20);
    expect(new Set(groups).size).toBe(2);
    expect(new Set(groups.slice(0, 10)).size).toBe(1);
    expect(new Set(groups.slice(10)).size).toBe(1);
  });
});

describe('what a person is asked for', () => {
  const render = () => renderToStaticMarkup(createElement(PersonFields, { draft: { name: 'Ava', color: hex(2) }, profiles: [], onChange: () => undefined }));
  const inputs = (markup: string) => [...markup.matchAll(/<input([^>]*)\/?>/g)].map(([, attributes]) => attributes ?? '');

  it('is a name and a colour, and no picture address', () => {
    const markup = render();
    const found = inputs(markup);
    const radios = found.filter((attributes) => /type="radio"/.test(attributes));
    const others = found.filter((attributes) => !/type="radio"/.test(attributes));
    expect(radios).toHaveLength(10);
    expect(others).toHaveLength(1);
    expect(others[0]).toMatch(/maxlength="100"/i);
    expect(words(markup)).toContain('Name');
    expect(words(markup)).toContain('Colour');
    expect(words(markup)).not.toMatch(/picture|address|https/i);
    expect(markup).not.toMatch(/type="url"|pattern="https/);
  });

  it("draws each colour's radio over the whole swatch, so that the control is as big as what is tapped", () => {
    const radios = inputs(render()).filter((attributes) => /type="radio"/.test(attributes));
    for (const attributes of radios) {
      expect(attributes).toMatch(/class="[^"]*\binset-0\b[^"]*\bsize-full\b/);
      expect(attributes).not.toContain('sr-only');
    }
  });
});

describe('deleting a person', () => {
  const render = () => renderToStaticMarkup(createElement(DeletePerson, { name: 'Ava', onCancel: () => undefined, onDelete: () => undefined }));

  it('says what goes with them', () => {
    expect(DELETE_PERSON_WORDS).toBe("Their Routines and every tick go. Events only for them, and calendars set to them, become everyone's.");
  });

  it('says so before the button that deletes, and names who is to go', () => {
    const shown = words(render());
    expect(shown).toContain(DELETE_PERSON_WORDS);
    expect(shown.indexOf(DELETE_PERSON_WORDS)).toBeLessThan(shown.lastIndexOf('Delete Ava'));
    expect(shown).toContain('Delete Ava?');
    const buttons = [...render().matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map(([, inner]) => words(inner ?? ''));
    expect(buttons).toEqual(['Cancel', 'Delete Ava']);
  });
});

describe('the phone\'s manifest', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8')) as Record<string, unknown>;

  it('does not ask for landscape, which the phone\'s pages never wanted', () => {
    expect(manifest).not.toHaveProperty('orientation');
  });

  it('takes the light ground for its two colours', () => {
    expect(manifest['theme_color']).toBe(TOKENS.light.background);
    expect(manifest['background_color']).toBe(TOKENS.light.background);
  });
});

// The two pages as they are first drawn, before anything is read: the cards they are made of, in order, and the words in them.
// They import the Supabase client, which is built on import and is not used to draw: a placeholder URL and key are enough to load
// them (as tests/appearance-section.test.ts does for the Appearance section).
describe("the phone's pages, as they are first drawn", () => {
  let SettingsPage: typeof SettingsPageType;
  let CalendarsPage: typeof CalendarsPageType;
  beforeAll(async () => {
    vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
    ({ SettingsPage } = await import('../src/SettingsPage'));
    ({ CalendarsPage } = await import('../src/CalendarsPage'));
  });

  const household: Household = {
    id: 'h1',
    name: 'The Andersons',
    timezone: 'America/Chicago',
    weather_place: 'Austin, Texas',
    latitude: 30.27,
    longitude: -97.74,
    temperature_unit: 'fahrenheit',
    appearance: 'auto',
  };
  const householdPage = () => renderToStaticMarkup(createElement(SettingsPage, { household, onSaved: () => undefined, onSignOut: () => undefined }));
  const calendarsPage = () => renderToStaticMarkup(createElement(CalendarsPage, { household }));

  const headings = (markup: string) => [...markup.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map(([, inner]) => words(inner ?? ''));
  const buttons = (markup: string) => [...markup.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attributes, inner]) => ({ attributes: attributes ?? '', name: words(inner ?? '') }));
  const primaries = (markup: string) => buttons(markup).filter(({ attributes }) => /class="[^"]*\bbg-primary\b/.test(attributes));

  // What the glossary calls things, which is for code, tests and tickets: the family reads people, tablets, time zone, lists, unpair.
  const GLOSSARY = /\b(Profiles?|Devices?|Household Timezone|Shared Lists?|Revoke|Calendar Accounts?|Mirrored Calendars?|Native Events?)\b/;

  it('hold Household, Appearance, Weather, People and Wall tablets, in that order, then Sign out', () => {
    const markup = householdPage();
    expect(headings(markup)).toEqual(['Household', 'Appearance', 'Weather', 'People', 'Wall tablets']);
    expect(buttons(markup).at(-1)?.name).toBe('Sign out');
  });

  it('put Appearance in a card of its own, between Household and Weather', () => {
    const markup = householdPage();
    const [household, appearance, weather] = ['household', 'appearance', 'weather'].map((card) => markup.search(new RegExp(`<h2[^>]*>${card}</h2>`, 'i')));
    expect(household).toBeLessThan(appearance!);
    expect(appearance).toBeLessThan(weather!);
    // The section brings its own heading, and its card is the one shell every card has.
    expect(markup).toMatch(/<div class="flex flex-col gap-4 rounded-3xl bg-card p-4"><section aria-labelledby="appearance-heading"/);
  });

  it('have one primary action between them: Save, on the Household page, and never two bare Saves', () => {
    expect(primaries(householdPage()).map(({ name }) => name)).toEqual(['Save']);
    expect(buttons(householdPage()).filter(({ name }) => name === 'Save')).toHaveLength(1);
    expect(primaries(calendarsPage())).toEqual([]);
  });

  it('list time zones by name, the stored one chosen, each with the IANA id as its value', () => {
    const markup = householdPage();
    expect(markup).toContain('<option value="America/Chicago" selected="">Central Time (Chicago)</option>');
    expect(markup).not.toMatch(/<option[^>]*>America\//);
  });

  it("say people, tablets, time zone, lists and unpair, and none of the glossary's words", () => {
    for (const markup of [householdPage(), calendarsPage()]) {
      expect(words(markup)).not.toMatch(GLOSSARY);
    }
    expect(words(householdPage())).toContain('Time zone');
    expect(words(householdPage())).toContain('Add a person');
    expect(words(householdPage())).toContain('Pair a tablet');
  });

  it('has no em-dash or en-dash', () => {
    for (const markup of [householdPage(), calendarsPage()]) expect(markup).not.toMatch(/[–—]/);
  });

  it('have no picture address field, and nothing that names one', () => {
    const markup = householdPage();
    expect(words(markup)).not.toMatch(/picture address|https:\/\//i);
    expect(markup).not.toMatch(/type="url"/);
  });

  it('put the Google calendars and the events added in Nidus on the Calendars page', () => {
    const markup = calendarsPage();
    expect(headings(markup)).toEqual(['Google calendars', 'Events added in Nidus']);
    expect(words(markup)).toContain('Connect a Google calendar');
    expect(words(markup)).toContain('Add event');
  });
});

// An account and a calendar of it, drawn from what they are told, since the page above is drawn before any is read.
describe('a Calendar Account and its calendars', () => {
  let CalendarRow: typeof CalendarRowType;
  let AccountSummary: typeof AccountSummaryType;
  beforeAll(async () => {
    vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
    ({ CalendarRow, AccountSummary } = await import('../src/CalendarAccountsSection'));
  });

  const members = [
    { id: 'p-cory', name: 'Cory', color: hex(7), avatar_url: null, sort_order: 0 },
    { id: 'p-sam', name: 'Sam', color: hex(9), avatar_url: null, sort_order: 1 },
  ];
  // A calendar that still has the colour it was given before a calendar had none.
  const family = { id: 'c1', calendar_account_id: 'a1', google_calendar_id: 'g1', name: 'Family', color: hex(7), profile_id: null, selected: true };
  const row = (calendar = family) => renderToStaticMarkup(createElement(CalendarRow, { calendar, profiles: members, onChange: () => undefined }));

  it('has whose it is to choose, and no colour to choose, though one is stored', () => {
    const markup = row();
    expect(markup.match(/<select/g)).toHaveLength(1);
    expect([...markup.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map(([, option]) => option)).toEqual(['Whole household', 'Cory', 'Sam']);
    expect(words(markup)).toContain('Whose calendar is Family?');
    expect(words(markup)).not.toMatch(/colou?r/i);
    for (const { name } of PROFILE_PALETTE) expect(markup).not.toContain(`>${name}<`);
    expect(markup).not.toContain(hex(7));
  });

  it('is a checkbox that is the whole row, ticked when the calendar is shown', () => {
    const shown = row();
    expect(shown).toMatch(/<input[^>]*type="checkbox"[^>]*checked=""/);
    expect(shown).toMatch(/<input[^>]*type="checkbox"[^>]*class="[^"]*\binset-0\b[^"]*\bsize-full\b/);
    const hidden = row({ ...family, selected: false });
    expect(hidden).not.toMatch(/checked=""/);
    expect(hidden).not.toContain('<select');
  });

  it('says of an account whose last update failed what Nidus says, and none of what the sync wrote', () => {
    const now = Date.parse('2026-10-01T19:21:00Z');
    const account = { id: 'a1', google_email: 'sam.work@example.com', status: 'active' as const, last_synced_at: '2026-10-01T16:21:00Z', last_error: 'Work: Google answered 500 (backendError)' };
    const shown = words(renderToStaticMarkup(createElement(AccountSummary, { account, now })));
    expect(shown).toContain('sam.work@example.com');
    expect(shown).toContain('Connected, but the last update failed. Nidus tries again every 5 minutes.');
    expect(shown).toContain('Last synced 3 hours ago');
    expect(shown).not.toMatch(/answered|500|backendError|Work/);
  });
});
