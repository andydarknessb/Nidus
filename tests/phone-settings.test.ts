import { readFileSync } from 'node:fs';
import { Fragment, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AccountBlock as AccountBlockType, AccountSummary as AccountSummaryType, CalendarRow as CalendarRowType, IphoneCalendarForm as IphoneCalendarFormType } from '../src/CalendarAccountsSection';
import type { CalendarsPage as CalendarsPageType } from '../src/CalendarsPage';
import type { EventRow as EventRowType } from '../src/EventsSection';
import type { RoutineForm as RoutineFormType, RoutinesPage as RoutinesPageType } from '../src/RoutinesPage';
import type { SettingsPage as SettingsPageType } from '../src/SettingsPage';
import type { SharedListsPage as SharedListsPageType } from '../src/SharedListsPage';
import { ColorPicker, DELETE_PERSON_WORDS, DeletePerson, PersonFields } from '../src/components/PersonEditor';
import { Confirm } from '../src/components/phone';
import { Button } from '../src/components/ui/button';
import type { Occurrence } from '../src/lib/calendar-occurrences';
import { ICLOUD_TRUNCATED_WORDS, UPDATE_FAILED_WORDS, accountStatusText, shownCalendar, stillPending, type CalendarAccount, type MirroredCalendar } from '../src/lib/calendar-accounts';
import { seenWords } from '../src/lib/device-format';
import type { Household } from '../src/lib/household';
import { TOKENS } from '../src/lib/look';
import { PROFILE_PALETTE, colorOwners, firstFreeColor } from '../src/lib/profiles';
import { SETTINGS_TABS, settingsLabelOf, settingsPathNow, settingsTabOf } from '../src/lib/settings-tabs';
import { timezoneName, timezoneOptions } from '../src/lib/timezones';
import { NOT_SAVED, NOT_SAVED_OFFLINE, giveName, isNetworkFailure, isRefusal, unnamed, writeFailureWords } from '../src/lib/write-failure';

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

  it('says of an iPhone calendar whose link broke the sentence the sync wrote, which is Nidus’s own, and Connected otherwise', () => {
    const broken = 'This link no longer works. Turn on Public Calendar again and paste the new link.';
    expect(accountStatusText({ provider: 'icloud', status: 'needs_reauth', last_error: broken })).toBe(broken);
    expect(accountStatusText({ provider: 'icloud', status: 'needs_reauth', last_error: null })).toBe('Needs to be connected again');
    expect(accountStatusText({ provider: 'icloud', status: 'active', last_error: null })).toBe('Connected');
    expect(accountStatusText({ provider: 'icloud', status: 'active', last_error: 'Feed answered 500' })).toBe(UPDATE_FAILED_WORDS);
    // A Google account is as it was: its last_error is never shown.
    expect(accountStatusText({ provider: 'google', status: 'needs_reauth', last_error: broken })).toBe('Needs to be connected again');
  });

  it('says of an active iPhone calendar whose repeating events were cut short that it is connected, and what was cut, in the family’s words', () => {
    const words = 'Connected. Some repeating events cannot be shown in full.';
    const note = 'Some repeating events in this calendar cannot be shown in full.';
    expect(accountStatusText({ provider: 'icloud', status: 'active', last_error: note })).toBe(words);
    expect(accountStatusText({ provider: 'icloud', status: 'active', last_error: note })).toBe(ICLOUD_TRUNCATED_WORDS);
    expect(words).not.toContain('\u2014');
    // Only an iPhone calendar's own sentence: any other error keeps the failed words, and Google never shows it.
    expect(accountStatusText({ provider: 'icloud', status: 'active', last_error: 'This calendar was not read this time; it will be tried again.' })).toBe(UPDATE_FAILED_WORDS);
    expect(accountStatusText({ provider: 'google', status: 'active', last_error: note })).toBe(UPDATE_FAILED_WORDS);
    expect(accountStatusText({ status: 'active', last_error: note })).toBe(UPDATE_FAILED_WORDS);
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

  it('names everyone who has a colour that more than one has, and draws the first one and a count', () => {
    const alex = { id: 'p3', name: 'Alex', color: hex(7), avatar_url: null, sort_order: 2 };
    const ben = { id: 'p4', name: 'Ben', color: hex(7), avatar_url: null, sort_order: 3 };
    expect(radios(render({ profiles: [cory, alex] }))[7]).toMatchObject({ name: 'Blue, in use by Cory and Alex', shown: 'C +1' });
    expect(radios(render({ profiles: [cory, alex, ben] }))[7]).toMatchObject({ name: 'Blue, in use by Cory, Alex and Ben', shown: 'C +2' });
  });

  it('isolates the initial and the count from each other and from the swatch, so a name written right to left cannot reorder them', () => {
    const alex = { id: 'p3', name: 'Alex', color: hex(7), avatar_url: null, sort_order: 2 };
    const sara = { id: 'p4', name: 'سارة', color: hex(7), avatar_url: null, sort_order: 3 };
    const markup = render({ profiles: [sara, cory, alex] });
    expect(markup).toContain('<bdi>س</bdi><bdi class="text-[14px]">+2</bdi>');
    // The count is words on a swatch, not a disc's initial: it keeps the 14 px floor (docs/look.md, Type).
    expect(markup).not.toMatch(/<bdi class="text-\[(?:\d|1[0-3])px\]">/);
    // And it is held in the swatch: it can neither grow it nor spill out of it.
    expect(markup).toMatch(/<span aria-hidden="true" class="[^"]*\bmax-w-full\b[^"]*\boverflow-hidden\b/);
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
    expect(DELETE_PERSON_WORDS).toBe("Their routines and every tick go. Events only for them, and calendars set to them, become everyone's.");
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
  let RoutinesPage: typeof RoutinesPageType;
  beforeAll(async () => {
    vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
    ({ SettingsPage } = await import('../src/SettingsPage'));
    ({ CalendarsPage } = await import('../src/CalendarsPage'));
    ({ RoutinesPage } = await import('../src/RoutinesPage'));
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
  const householdPage = () => renderToStaticMarkup(createElement(SettingsPage, { household, userId: 'u1', onSaved: () => undefined, onSignOut: () => undefined }));
  const calendarsPage = () => renderToStaticMarkup(createElement(CalendarsPage, { household }));
  const routinesPage = () => renderToStaticMarkup(createElement(RoutinesPage, { household }));

  const headings = (markup: string) => [...markup.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map(([, inner]) => words(inner ?? ''));
  const buttons = (markup: string) => [...markup.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attributes, inner]) => ({ attributes: attributes ?? '', name: words(inner ?? '') }));
  const primaries = (markup: string) => buttons(markup).filter(({ attributes }) => /class="[^"]*\bbg-primary\b/.test(attributes));

  // What the glossary calls things, which is for code, tests and tickets: the family reads people, tablets, time zone, lists, unpair.
  const GLOSSARY = /\b(Profiles?|Devices?|Household Timezone|Shared Lists?|Revoke|Calendar Accounts?|Mirrored Calendars?|Native Events?)\b/;

  it('hold Household, Appearance, Weather, People, Wall tablets, Who can sign in and Notifications on this phone, in that order, then Sign out', () => {
    const markup = householdPage();
    expect(headings(markup)).toEqual(['Household', 'Appearance', 'Weather', 'People', 'Wall tablets', 'Who can sign in', 'Notifications on this phone']);
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
    expect(headings(markup)).toEqual(['Google calendars', 'iPhone calendars', 'Events added in Nidus']);
    expect(words(markup)).toContain('Connect a Google calendar');
    expect(words(markup)).toContain('Add event');
  });

  it('start the Routines page where the Lists page starts: its status line is on the page from the first draw, and takes no room while it is empty', () => {
    // The Lists page has its one h1, off screen, and then its first card. The Routines page had a status line that held a line of
    // its own (a minimum height, 12 px from the next part) whether or not it had anything to say: a blank band over its first card.
    const markup = routinesPage();
    expect(markup.match(/<h1\b/g)).toHaveLength(1);
    expect(markup).toContain('<h1 class="sr-only">Routines</h1>');
    // It is there from the first draw, so a screen reader hears a sentence when it arrives; it is out of the layout while it is empty.
    const status = /<p role="status" class="([^"]*)"><\/p>/.exec(markup)?.[1]?.split(' ');
    expect(status).toContain('empty:sr-only');
    expect(status).not.toContain('min-h-6');
    // Nothing else comes before the first card: the page's own top padding is the Lists page's.
    expect(markup).toMatch(/^<main class="[^"]*\bgap-3 px-4 pt-2 pb-6">/);
    expect(markup).toMatch(/<\/h1><p role="status" class="[^"]*"><\/p><\/main>$/);
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
    // The whole Household is "Everyone" here as it is on the Wall (the people strip, the Add event sheet, an event's details).
    expect([...markup.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map(([, option]) => option)).toEqual(['Everyone', 'Cory', 'Sam']);
    expect(words(markup)).not.toContain('Whole household');
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

  it('says what went wrong under its own row, as an alert, and says nothing otherwise', () => {
    const failed = renderToStaticMarkup(createElement(CalendarRow, { calendar: family, profiles: members, problem: { words: 'That did not save. Try again.' }, onChange: () => undefined }));
    expect(failed).toContain('role="alert"');
    expect(words(failed)).toContain('That did not save. Try again.');
    expect(row()).not.toContain('role="alert"');
  });

  it('says of an account whose last update failed what Nidus says, and none of what the sync wrote', () => {
    const now = Date.parse('2026-10-01T19:21:00Z');
    const account = { id: 'a1', provider: 'google' as const, google_email: 'sam.work@example.com', status: 'active' as const, last_synced_at: '2026-10-01T16:21:00Z', last_error: 'Work: Google answered 500 (backendError)' };
    const shown = words(renderToStaticMarkup(createElement(AccountSummary, { account, now })));
    expect(shown).toContain('sam.work@example.com');
    expect(shown).toContain('Connected, but the last update failed. Nidus tries again every 5 minutes.');
    expect(shown).toContain('Last synced 3 hours ago');
    expect(shown).not.toMatch(/answered|500|backendError|Work/);
  });
});


// An iPhone calendar in Settings (spec 0005, Settings): the form that adds one, and the account that lists one.
describe('iPhone calendars in Settings', () => {
  let AccountBlock: typeof AccountBlockType;
  let IphoneCalendarForm: typeof IphoneCalendarFormType;
  beforeAll(async () => {
    vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
    ({ AccountBlock, IphoneCalendarForm } = await import('../src/CalendarAccountsSection'));
  });

  const noop = () => undefined;
  const members = [
    { id: 'p-cory', name: 'Cory', color: hex(7), avatar_url: null, sort_order: 0 },
    { id: 'p-sam', name: 'Sam', color: hex(9), avatar_url: null, sort_order: 1 },
  ];
  const now = Date.parse('2026-10-01T19:21:00Z');
  const form = (props: Partial<Parameters<typeof IphoneCalendarFormType>[0]> = {}) =>
    renderToStaticMarkup(createElement(IphoneCalendarForm, { value: '', adding: false, onChange: noop, onAdd: noop, ...props }));

  it('says the steps in plain words, then a field labelled Link, then Add', () => {
    expect(words(form())).toBe(
      'On your iPhone, open Calendar, tap Calendars, tap the i next to a calendar, turn on Public Calendar, tap Share Link, then Copy Link. Paste it here. Link Add',
    );
  });

  it('makes the field a link field a phone does not correct, tied to the steps', () => {
    const markup = form();
    const input = /<input[^>]*>/.exec(markup)![0];
    expect(input).toContain('type="url"');
    expect(input).toContain('inputMode="url"');
    expect(input).toContain('autoCapitalize="off"');
    expect(input).toContain('autoCorrect="off"');
    expect(input).toContain('spellCheck="false"');
    // The label is the field's parent, so a tap on "Link" reaches it, and the field is the 56 tall one.
    expect(markup).toMatch(/<label[^>]*><span[^>]*>Link<\/span><input/);
    expect(input).toMatch(/class="[^"]*\bh-14\b[^"]*\bw-full\b/);
    const steps = /<p id="([^"]+)"/.exec(markup)![1];
    expect(input).toContain(`aria-describedby="${steps}"`);
  });

  it('marks the field invalid while a problem shows, and not otherwise', () => {
    const input = (markup: string) => /<input[^>]*>/.exec(markup)![0];
    expect(input(form({ problem: { words: 'That is not an iPhone calendar link.', n: 1 } }))).toContain('aria-invalid="true"');
    expect(input(form())).not.toContain('aria-invalid');
  });

  it('says "Adding" while it adds, and does nothing then', () => {
    expect(form({ adding: true })).toMatch(/<button[^>]*aria-disabled="true"[^>]*>Adding<\/button>/);
    expect(form()).toMatch(/<button[^>]*type="submit"[^>]*>Add<\/button>/);
    expect(form()).not.toContain('aria-disabled=');
  });

  it('says what the route said under the field, as an alert the field points to', () => {
    const markup = form({ problem: { words: 'That is not an iPhone calendar link.', n: 1 } });
    const alert = /<p id="([^"]+)" role="alert"[^>]*>That is not an iPhone calendar link\.<\/p>/.exec(markup);
    expect(alert).not.toBeNull();
    expect(/<input[^>]*>/.exec(markup)![0]).toContain(alert![1]!);
    expect(form()).not.toContain('role="alert"');
  });

  const google: CalendarAccount = { id: 'a1', provider: 'google', google_email: 'sam.work@example.com', status: 'needs_reauth', last_synced_at: '2026-10-01T16:21:00Z', last_error: null };
  const iphone: CalendarAccount = { id: 'a2', provider: 'icloud', google_email: null, status: 'active', last_synced_at: '2026-10-01T19:16:00Z', last_error: null };
  const gcal: MirroredCalendar = { id: 'c1', calendar_account_id: 'a1', google_calendar_id: 'g1', name: 'Family', color: null, profile_id: null, selected: true };
  const ical: MirroredCalendar = { id: 'c2', calendar_account_id: 'a2', google_calendar_id: 'ics', name: 'Sam’s iPhone', color: null, profile_id: 'p-sam', selected: true };
  const block = (account: CalendarAccount, calendars: MirroredCalendar[], extra: Partial<Parameters<typeof AccountBlockType>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(AccountBlock, {
        account,
        calendars,
        profiles: members,
        now,
        confirming: false,
        removing: false,
        problems: { at: () => null },
        onReconnect: noop,
        onChoose: noop,
        onAskRemove: noop,
        onCancelRemove: noop,
        onRemove: noop,
        ...extra,
      }),
    );

  it('lists an iPhone calendar by its name, "iPhone calendar", status, last sync, whose it is, and Remove', () => {
    const markup = block(iphone, [ical]);
    expect(words(markup)).toBe('Sam’s iPhone iPhone calendar Connected Last synced 5 minutes ago Whose calendar is Sam’s iPhone? Everyone Cory Sam Remove Sam’s iPhone');
    expect(markup).toMatch(/<option value="p-sam" selected="">Sam<\/option>/);
    expect(/<button[^>]*id="remove-a2"/.test(markup)).toBe(true);
  });

  it('does not say "iPhone calendar" twice when the calendar has no name of its own', () => {
    const markup = block(iphone, [{ ...ical, name: 'iPhone calendar' }]);
    expect(markup.match(/>iPhone calendar</g)).toHaveLength(1);
    expect(words(markup)).toContain('iPhone calendar Connected');
    expect(block(iphone, [ical]).match(/>iPhone calendar</g)).toHaveLength(1);
  });

  it('shows none of Google’s controls for an iPhone calendar, even when its link broke', () => {
    const markup = block({ ...iphone, status: 'needs_reauth', last_error: 'This link no longer works. Turn on Public Calendar again and paste the new link.' }, [ical]);
    expect(words(markup)).toContain('This link no longer works. Turn on Public Calendar again and paste the new link.');
    expect(markup).not.toMatch(/Connect |Connecting again|Choose the calendars|type="checkbox"|Google|google_email|consent/i);
    expect(markup.match(/<button/g)).toHaveLength(1);
  });

  it('keeps a Google account as it was: reconnect, the choice of its calendars, and Remove', () => {
    const markup = block(google, [gcal]);
    expect(words(markup)).toContain('sam.work@example.com');
    expect(words(markup)).toContain('Connect sam.work@example.com again');
    expect(words(markup)).toContain('Choose the calendars to show');
    expect(markup).toContain('type="checkbox"');
    expect(words(markup)).toContain('Remove sam.work@example.com');
    expect(words(markup)).not.toContain('iPhone calendar');
  });

  it('asks before removing an iPhone calendar, in its own words, naming it', () => {
    const shown = words(block(iphone, [ical], { confirming: true }));
    expect(shown).toContain('Remove Sam’s iPhone?');
    expect(shown).toContain('Its events leave the Wall and Nidus forgets its link.');
    expect(shown).toContain('Keep it');
    expect(shown).toContain('Yes, remove it');
  });

  it('says what a write of its person said, under it', () => {
    const markup = block(iphone, [ical], { problems: { at: (place) => (place === 'calendar-c2' ? { words: 'That did not save. Try again.' } : null) } });
    expect(markup).toContain('role="alert"');
    expect(words(markup)).toContain('That did not save. Try again.');
  });

  it('has no em-dash or en-dash, and no word the glossary keeps for code', () => {
    const markup = form() + block(iphone, [ical]) + block(iphone, [ical], { confirming: true });
    expect(markup).not.toMatch(/[–—]/);
    expect(words(markup)).not.toMatch(/\b(Profiles?|Devices?|Calendar Accounts?|Mirrored Calendars?|Native Events?)\b|iCloud/);
  });
});

// What a write that did not go through says: the Wall's two sentences, the form's own words for a value the database refused.
describe('a write that did not go through', () => {
  // supabase-js hands a fetch that threw back as an error with no code and the browser's own words.
  const offlineError = { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' };
  const serverError = { message: 'permission denied', details: '', hint: '', code: '42501' };
  const refusal = { message: 'violates check constraint', details: '', hint: '', code: '23514' };
  const REFUSAL = 'Could not save the person. Check the name and try again.';

  it("says the Wall's two sentences: with no connection, and otherwise", () => {
    expect(NOT_SAVED).toBe('That did not save. Try again.');
    expect(NOT_SAVED_OFFLINE).toBe('No internet, so that did not save. Try again soon.');
    expect(writeFailureWords(serverError, { offline: false })).toBe(NOT_SAVED);
    expect(writeFailureWords(offlineError, { offline: false })).toBe(NOT_SAVED_OFFLINE);
    expect(writeFailureWords(new Error('boom'), { offline: false })).toBe(NOT_SAVED);
  });

  it('knows a request that never got an answer, however the browser words it', () => {
    for (const message of ['TypeError: Failed to fetch', 'TypeError: Load failed', 'TypeError: NetworkError when attempting to fetch resource.', 'FetchError: network request failed']) {
      expect(isNetworkFailure({ message, code: '' }), message).toBe(true);
    }
    expect(isNetworkFailure(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkFailure({ name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function' })).toBe(true);
    // An answer, even a refusal, has a code; and what is not an error is not one.
    expect(isNetworkFailure(serverError)).toBe(false);
    expect(isNetworkFailure(refusal)).toBe(false);
    expect(isNetworkFailure({ message: 'Failed to fetch', code: '42501' })).toBe(false);
    expect(isNetworkFailure(null)).toBe(false);
    expect(isNetworkFailure('Failed to fetch')).toBe(false);
  });

  it('says the screen was offline when it was, if the error does not say otherwise', () => {
    expect(writeFailureWords(new Error('boom'), { offline: true })).toBe(NOT_SAVED_OFFLINE);
    // The server answered, so there was a connection whatever the screen thought.
    expect(writeFailureWords(serverError, { offline: true })).toBe(NOT_SAVED);
  });

  it('keeps "Check the name" for a value the database refused, and only when the form asked to say so', () => {
    expect(writeFailureWords(refusal, { offline: false, refusal: REFUSAL })).toBe(REFUSAL);
    expect(writeFailureWords(refusal, { offline: true, refusal: REFUSAL })).toBe(REFUSAL);
    expect(writeFailureWords(refusal, { offline: false })).toBe(NOT_SAVED);
    // Not a refusal: no name is to be checked, whatever else is wrong.
    expect(writeFailureWords(serverError, { offline: false, refusal: REFUSAL })).toBe(NOT_SAVED);
    expect(writeFailureWords(offlineError, { offline: false, refusal: REFUSAL })).toBe(NOT_SAVED_OFFLINE);
    expect(isRefusal(refusal)).toBe(true);
    expect(isRefusal({ code: '22001' })).toBe(true);
    expect(isRefusal(serverError)).toBe(false);
    expect(isRefusal(offlineError)).toBe(false);
  });

  it('names an action that is not a save in both sentences', () => {
    const said = { failed: 'Could not start connecting to Google. Try again.', offline: 'No internet, so that did not start. Try again soon.' };
    expect(writeFailureWords(serverError, { offline: false, said })).toBe(said.failed);
    expect(writeFailureWords(offlineError, { offline: false, said })).toBe(said.offline);
  });

  it('has no em-dash or en-dash, and no glossary word, in anything it says', () => {
    for (const sentence of [NOT_SAVED, NOT_SAVED_OFFLINE]) {
      expect(sentence).not.toMatch(/[–—]/);
      expect(sentence).not.toMatch(/Profile|Device|Revoke/);
    }
  });
});

// A form that is asked to save with no name says so in its own problem line, before anything is sent.
describe('a form asked to save with no name', () => {
  it('says what to do, in plain words, for the routine, the person and the list', () => {
    expect(giveName('routine')).toBe('Give the routine a name.');
    expect(giveName('person')).toBe('Give the person a name.');
    expect(giveName('list')).toBe('Give the list a name.');
    for (const what of ['routine', 'person', 'list'] as const) {
      expect(giveName(what)).not.toMatch(/[–—]/);
      expect(giveName(what)).not.toMatch(/Profile|Shared List|Routine/);
    }
  });

  it('says nothing until it has been asked, and nothing once the name is there', () => {
    expect(unnamed('list', 0, '')).toBeNull();
    expect(unnamed('list', 1, 'Costco')).toBeNull();
    expect(unnamed('list', 2, '  Costco ')).toBeNull();
  });

  it('says it for a name that is empty or only spaces, and says it again for each time it is asked', () => {
    expect(unnamed('routine', 1, '')).toEqual({ words: 'Give the routine a name.', n: 1 });
    expect(unnamed('routine', 2, '   ')).toEqual({ words: 'Give the routine a name.', n: 2 });
  });
});

// The forms that ask for a name, as they are first drawn: the browser's own bubble for an empty field is off, so what an empty name
// says is the form's own line, which is not there until the form has been asked to save.
describe('the phone forms that ask for a name', () => {
  let RoutineForm: typeof RoutineFormType;
  let SharedListsPage: typeof SharedListsPageType;
  beforeAll(async () => {
    vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
    ({ RoutineForm } = await import('../src/RoutinesPage'));
    ({ SharedListsPage } = await import('../src/SharedListsPage'));
  });

  const ava = { id: 'p-ava', name: 'Ava', color: hex(2), avatar_url: null, sort_order: 0 };
  const routineForm = () => renderToStaticMarkup(createElement(RoutineForm, { profile: ava, onSave: async () => true }));
  const household: Household = { id: 'h1', name: 'The Andersons', timezone: 'America/Chicago', weather_place: null, latitude: null, longitude: null, temperature_unit: 'fahrenheit', appearance: 'auto' };
  const listsPage = () => renderToStaticMarkup(createElement(SharedListsPage, { household }));

  it('has no example in the field for a new routine: an example reads as a name that was already given', () => {
    const markup = routineForm();
    expect(markup).not.toContain('Feed the dog');
    expect(markup).not.toContain('placeholder=');
  });

  it('leaves an empty name to its own line, and still tells a screen reader the field is needed', () => {
    const markup = routineForm();
    expect(markup).toMatch(/^<form[^>]*\bnoValidate=""/);
    expect(markup).toMatch(/<input[^>]*\brequired=""/);
    expect(markup).not.toContain('role="alert"');
    expect(words(markup)).not.toContain(giveName('routine'));
  });

  it('has a New list form that leaves an empty name to its own line, as the other two do', () => {
    const markup = listsPage();
    expect(markup).toMatch(/<form[^>]*\bnoValidate=""[^>]*>[\s\S]*?Add list/);
    expect(markup).not.toContain('role="alert"');
    expect(words(markup)).not.toContain(giveName('list'));
  });
});

// A calendar's switch and its person are sent one at a time, shown at once, and put back if the write fails.
describe("a calendar's choices, one field at a time", () => {
  const family = { id: 'c1', calendar_account_id: 'a1', google_calendar_id: 'g1', name: 'Family', color: null, profile_id: null, selected: true };

  it('are shown at once, laid over what is stored', () => {
    expect(shownCalendar(family, undefined)).toBe(family);
    expect(shownCalendar(family, { selected: false })).toEqual({ ...family, selected: false });
    expect(shownCalendar(family, { profile_id: 'p1' })).toEqual({ ...family, profile_id: 'p1' });
    expect(shownCalendar(family, { selected: false, profile_id: 'p1' })).toEqual({ ...family, selected: false, profile_id: 'p1' });
  });

  it('stop being pending when they are answered, whether they landed or failed', () => {
    expect(stillPending({ selected: false }, { selected: false })).toBeUndefined();
    expect(stillPending({ profile_id: 'p1' }, { profile_id: 'p1' })).toBeUndefined();
    expect(stillPending({ selected: false, profile_id: 'p1' }, { selected: false })).toEqual({ profile_id: 'p1' });
  });

  it('stay pending for a field that was asked for again since: it has an answer of its own to wait for', () => {
    expect(stillPending({ selected: true }, { selected: false })).toEqual({ selected: true });
    expect(stillPending({ profile_id: null }, { profile_id: 'p1' })).toEqual({ profile_id: null });
  });

  it('are nothing to answer for a calendar with nothing pending', () => {
    expect(stillPending(undefined, { selected: true })).toBeUndefined();
  });
});

// The question before something is taken away: the three the phone asks (delete a person, unpair a tablet, remove an account).
describe('the question before something is taken away', () => {
  const render = (props: Partial<Parameters<typeof Confirm>[0]> = {}) =>
    renderToStaticMarkup(createElement(Confirm, { title: 'Delete Ava?', words: 'Their routines go.', cancel: 'Cancel', confirm: 'Delete Ava', onCancel: () => undefined, onConfirm: () => undefined, ...props }));
  const tag = (markup: string, name: string) => new RegExp(`<button[^>]*>\\s*${name}\\s*</button>`).exec(markup)?.[0] ?? '';
  const idOf = (markup: string, element: string) => new RegExp(`<${element}[^>]*\\bid="([^"]*)"`).exec(markup)?.[1];

  it('is a group named by its question', () => {
    const markup = render();
    const labelledBy = /role="group" aria-labelledby="([^"]*)"/.exec(markup)?.[1];
    expect(labelledBy).toBeDefined();
    expect(labelledBy).toBe(idOf(markup, 'h3'));
  });

  it('has both answers described by what goes, so it is read when the focus lands on the safe one', () => {
    const markup = render();
    expect(tag(markup, 'Cancel')).toContain(`aria-describedby="${idOf(markup, 'p')}"`);
    expect(tag(markup, 'Delete Ava')).toContain(`aria-describedby="${idOf(markup, 'p')}"`);
  });

  it('lets its buttons shrink, so a name that is one long word breaks inside the word and never reaches past the card', () => {
    const markup = render({ confirm: `Delete ${'W'.repeat(100)}` });
    const classes = /<button[^>]*class="([^"]*)"[^>]*>\s*Delete W/.exec(markup)?.[1] ?? '';
    expect(classes.split(' ')).toContain('shrink');
    expect(classes.split(' ')).not.toContain('shrink-0');
    expect(classes).toContain('[overflow-wrap:anywhere]');
  });

  it('puts the safe answer first, and the one that does it in the delete voice after it', () => {
    const markup = render();
    expect(markup.indexOf('>Cancel<')).toBeLessThan(markup.indexOf('>Delete Ava<'));
    expect(tag(markup, 'Delete Ava')).toMatch(/class="[^"]*\bbg-destructive\b/);
  });

  it('is aria-disabled on both buttons while its write is on its way, and never disabled, which would drop the focus', () => {
    const busy = render({ busy: true });
    expect(tag(busy, 'Cancel')).toContain('aria-disabled="true"');
    expect(tag(busy, 'Delete Ava')).toContain('aria-disabled="true"');
    for (const markup of [busy, render()]) expect(markup).not.toMatch(/\sdisabled(=|\s|>)/);
    expect(tag(render(), 'Cancel')).not.toContain('aria-disabled="');
  });

  it('says what went wrong under the buttons, as an alert, and tied to the answer it is on', () => {
    const markup = render({ problem: { words: NOT_SAVED } });
    expect(markup).toContain('role="alert"');
    expect(markup.indexOf('>Delete Ava<')).toBeLessThan(markup.indexOf(NOT_SAVED));
    const problemId = /<p id="([^"]*)" role="alert"/.exec(markup)?.[1];
    expect(problemId).toBeDefined();
    expect(tag(markup, 'Cancel')).toContain(problemId!);
    expect(render()).not.toContain('role="alert"');
  });

  it('says what went wrong in the question about deleting a person too', () => {
    const markup = renderToStaticMarkup(createElement(DeletePerson, { name: 'Ava', problem: { words: NOT_SAVED_OFFLINE }, onCancel: () => undefined, onDelete: () => undefined }));
    expect(words(markup)).toContain(DELETE_PERSON_WORDS);
    expect(words(markup)).toContain(NOT_SAVED_OFFLINE);
  });
});

// A name the database refused is tied to the field that was refused.
describe('what a person is asked for, after a write did not go through', () => {
  const render = (problem?: { id: string; refused: boolean }) =>
    renderToStaticMarkup(createElement(PersonFields, { draft: { name: ' ', color: hex(2) }, profiles: [], problem, onChange: () => undefined }));
  const nameField = (markup: string) => /<input(?![^>]*type="radio")[^>]*>/.exec(markup)?.[0] ?? '';

  it('ties the sentence to the name when the name was refused', () => {
    const field = nameField(render({ id: 'problem-add', refused: true }));
    expect(field).toContain('aria-invalid="true"');
    expect(field).toContain('aria-describedby="problem-add"');
  });

  it('does not call the name wrong when the trouble was the connection or the server', () => {
    const field = nameField(render({ id: 'problem-add', refused: false }));
    expect(field).not.toContain('aria-invalid');
    expect(field).not.toContain('aria-describedby');
    expect(nameField(render())).not.toContain('aria-invalid');
  });
});

// Who an event is for, on the phone's list of the events added in Nidus: the schedule's rule (pillPeople), read as words.
describe("the phone's list of events", () => {
  let EventRow: typeof EventRowType;
  beforeAll(async () => {
    vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
    ({ EventRow } = await import('../src/EventsSection'));
  });

  const family = [
    { id: 'p-cory', name: 'Cory', color: hex(7), avatar_url: null, sort_order: 0 },
    { id: 'p-sam', name: 'Sam', color: hex(9), avatar_url: null, sort_order: 1 },
    { id: 'p-ava', name: 'Ava', color: hex(2), avatar_url: null, sort_order: 2 },
  ];
  const crowd = [...family, { id: 'p-ben', name: 'Ben', color: hex(4), avatar_url: null, sort_order: 3 }];
  const event = (profileIds: string[]): Occurrence => ({
    source: 'native',
    id: 'e1',
    calendar_id: null,
    calendar_name: 'Nidus',
    title: 'Plumber coming',
    description: null,
    location: null,
    starts_at: '2026-10-02T19:00:00Z',
    ends_at: '2026-10-02T20:00:00Z',
    is_all_day: false,
    profile_id: profileIds[0] ?? null,
    profile_ids: profileIds,
  });
  const row = (profileIds: string[], profiles = family) => renderToStaticMarkup(createElement(EventRow, { event: event(profileIds), profiles, timezone: 'America/Chicago', onOpen: () => undefined }));
  const forWords = (markup: string) => /<span class="sr-only">([^<]*)<\/span>/.exec(markup)?.[1]?.replace(/<!-- -->/g, '');

  it('says who an event is for, as the schedule does', () => {
    expect(forWords(row([]))).toBe('For everyone');
    expect(forWords(row(['p-ava']))).toBe('For Ava');
    expect(forWords(row(['p-ava', 'p-cory']))).toBe('For Cory and Ava');
    expect(forWords(row(['p-cory', 'p-sam', 'p-ava']))).toBe('For everyone');
    expect(forWords(row(['p-cory', 'p-sam'], crowd))).toBe('For Cory and Sam');
  });

  it("draws the Wall pill's own discs: the house, a disc for one or two, a disc and a count for more", () => {
    expect(row([])).toContain('bg-primary');
    expect(words(row(['p-ava']))).toContain('A');
    expect(words(row(['p-cory', 'p-ava']))).toMatch(/\bC\b.*\bA\b/);
    expect(words(row(['p-cory', 'p-sam', 'p-ava'], crowd))).toContain('+2');
  });

  it('puts the pin before the title of a Native Event, and the time under it', () => {
    const markup = row([]);
    expect(markup.indexOf('<svg')).toBeLessThan(markup.indexOf('Plumber coming'));
    expect(words(markup)).toMatch(/Plumber coming.*Fri, Oct 2/);
  });
});

// Nothing the phone's pages draw that has, or may have, the focus is ever `disabled`: a button that is disabled while it has focus
// drops it to the page. A busy one is `aria-disabled` and its handler ignores the press (the Button draws both the same).
describe("the phone's buttons", () => {
  const files = ['AdminApp', 'SettingsPage', 'ProfilesSection', 'WeatherSection', 'DevicesSection', 'HouseholdAccountsSection', 'NotificationsSection', 'CalendarAccountsSection', 'EventsSection', 'components/phone', 'components/PersonEditor'];
  const source = (file: string) => readFileSync(new URL(`../src/${file}.tsx`, import.meta.url), 'utf8').replace(/\s+/g, ' ');

  it('are never `disabled` where the person has pressed them', () => {
    for (const file of files) expect(source(file), file).not.toMatch(/<Button\b[^>]*\sdisabled[=\s>{]/);
  });

  it('draw a busy button as a switched off one, which does nothing when it is tapped and keeps the focus', () => {
    const markup = renderToStaticMarkup(createElement(Button, { 'aria-disabled': true }, 'Save'));
    expect(markup).toContain('aria-disabled="true"');
    expect(markup).toMatch(/\baria-disabled:opacity-40\b/);
    // It still takes a tap, which only keeps the focus where it was: pointer events off would hand the tap to what is under it.
    expect(markup).not.toMatch(/\baria-disabled:pointer-events-none\b/);
    expect(markup).not.toMatch(/\sdisabled(=|\s|>)/);
  });
});
