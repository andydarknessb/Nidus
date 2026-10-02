import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DayCell } from '../src/components/MonthCell';
import { monthWeeks, type Occurrence } from '../src/lib/calendar-occurrences';
import { personStyle, TOKENS, type Mode } from '../src/lib/look';
import { contrastRatio, type Profile } from '../src/lib/profiles';

// A month's day cell rendered to markup (as tests/event-pill.test.ts does for the pill), so what is asserted is what the browser is
// given: the date, with today's in a filled disc and no underline; the event lines, each filled from the Profiles it is for and
// never from a Mirrored Calendar, with the words in --foreground, the pin before a Native Event's title, and one line each; the
// hatch of a day beyond the calendar's range, drawn in --input; and a name that starts with what is drawn.

const CHICAGO = 'America/Chicago';
const TODAY = '2026-10-01';
const GRID = monthWeeks('2026-10-01', CHICAGO, TODAY).flat();
const dayOf = (date: string) => GRID.find((each) => each.date === date)!;

const profile = (id: string, name: string, sort: number, color: string): Profile => ({ id, name, color, avatar_url: null, sort_order: sort });
const CORY = profile('p-cory', 'Cory', 0, '#93c5fd');
const SAM = profile('p-sam', 'Sam', 1, '#f9a8d4');
const AVA = profile('p-ava', 'Ava', 2, '#fcd34d');
const BEN = profile('p-ben', 'Ben', 3, '#6ee7b7');
const FAMILY = [CORY, SAM, AVA, BEN];

let counter = 0;
// 9:00 to 10:00 AM on Thu Oct 1, Chicago (CDT, UTC-5). A Mirrored Calendar's colours are on it, which a line never draws.
function event(title: string, profileIds: string[], more: Partial<Occurrence> = {}): Occurrence {
  counter += 1;
  return {
    source: 'synced',
    id: `event-${counter}`,
    calendar_id: 'calendar-1',
    calendar_name: 'Family',
    title,
    description: null,
    location: null,
    starts_at: '2026-10-01T14:00:00Z',
    ends_at: '2026-10-01T15:00:00Z',
    is_all_day: false,
    profile_id: profileIds[0] ?? null,
    color: '#ff0000',
    profile_ids: profileIds,
    colors: ['#ff0000', '#00ff00'],
    ...more,
  };
}
const native = (title: string, profileIds: string[] = []) => event(title, profileIds, { source: 'native', calendar_id: null, calendar_name: 'Nidus' });

type Options = { occurrences?: Occurrence[] | null; profiles?: Profile[]; lines?: number; inMonth?: boolean; beyond?: boolean };

function cell(date: string, { occurrences = [], profiles = FAMILY, lines = 3, inMonth = true, beyond = false }: Options = {}): string {
  return renderToStaticMarkup(createElement(DayCell, { day: dayOf(date), inMonth, beyond, occurrences, profiles, lines, timezone: CHICAGO, onOpen: () => undefined }));
}

const count = (html: string, text: string) => html.split(text).length - 1;
const nameOf = (html: string) => /aria-label="([^"]*)"/.exec(html)?.[1];
const classesOf = (tag: string) => /class="([^"]*)"/.exec(tag)?.[1]?.split(' ') ?? [];
// The classes of the cell itself: its opening tag.
const cellClasses = (html: string) => classesOf(html.slice(0, html.indexOf('>') + 1));
// The classes of the span whose only content is `text`: the date, a title, "+3 more".
function spanWith(html: string, text: string): string[] {
  const at = html.indexOf(`>${text}<`);
  if (at < 0) throw new Error(`no element has only "${text}" in it:\n${html}`);
  return classesOf(html.slice(html.lastIndexOf('<span', at), at + 1));
}
const lineTag = (html: string) => /<span[^>]*data-testid="event-line"[^>]*>/.exec(html)?.[0] ?? '';
// The 300 step a Profile's element carries, which only that Profile's own colour can put in the markup.
const step300 = (who: Profile) => (personStyle(who.color) as Record<string, string>)['--person-300']!;

describe('a day cell', () => {
  it('is one button that opens the day, filling its cell, with the lines inside it and not buttons of their own', () => {
    const html = cell('2026-10-01', { occurrences: [event('Standup', ['p-cory']), event('Piano', ['p-ava'])] });
    expect(html.startsWith('<button')).toBe(true);
    expect(count(html, '<button')).toBe(1);
    expect(html).toContain('type="button"');
    expect(cellClasses(html)).toEqual(expect.arrayContaining(['h-auto', 'w-full', 'min-w-0', 'overflow-hidden']));
  });

  it('answers a press, and a keyboard focus inside its own box, as every button does', () => {
    const classes = cellClasses(cell('2026-10-02'));
    expect(classes).toContain('active:bg-accent');
    expect(classes).toContain('focus-visible:-outline-offset-2');
  });
});

describe("a day cell's name", () => {
  it('starts with what is drawn on it, the date, then the day in full and how many events it holds', () => {
    expect(nameOf(cell('2026-10-01', { occurrences: [event('A', []), event('B', []), event('C', [])] }))).toBe('1, Thursday, October 1, 3 events');
    expect(nameOf(cell('2026-10-22'))).toBe('22, Thursday, October 22, no events');
    expect(nameOf(cell('2026-10-03', { occurrences: [event('A', [])] }))).toBe('3, Saturday, October 3, 1 event');
  });

  it('is the date alone until its week has been read, so a day not yet known is never called free', () => {
    expect(nameOf(cell('2026-10-02', { occurrences: null }))).toBe('2, Friday, October 2');
  });

  it('draws the date it starts with before anything else in the cell', () => {
    const html = cell('2026-10-22', { occurrences: [event('Standup', ['p-cory'])] });
    expect(html).toContain('>22<');
    expect(html.indexOf('>22<')).toBeLessThan(html.indexOf('Standup'));
  });

  it('marks today as the current date, and no other day', () => {
    expect(cell('2026-10-01')).toContain('aria-current="date"');
    expect(cell('2026-10-02')).not.toContain('aria-current');
  });
});

describe("today's date", () => {
  it('is in a filled disc in --primary, and no underline is drawn anywhere in the cell', () => {
    const html = cell('2026-10-01', { occurrences: [event('Standup', ['p-cory'])] });
    expect(spanWith(html, '1')).toEqual(expect.arrayContaining(['bg-primary', 'text-primary-foreground', 'rounded-full', 'font-display']));
    expect(html).not.toContain('underline');
  });

  it('is only a date, in the display face, on any other day, with no disc', () => {
    const html = cell('2026-10-02');
    expect(spanWith(html, '2')).toContain('font-display');
    expect(html).not.toContain('bg-primary');
    expect(html).not.toContain('underline');
  });

  it("lifts the cell's ground to --muted, as today's column is on Home and Week", () => {
    expect(cellClasses(cell('2026-10-01'))).toContain('bg-muted');
    expect(cellClasses(cell('2026-10-02'))).not.toContain('bg-muted');
  });

  it('dims the date of a day of the neighbouring month, and not the date of a day of this one', () => {
    expect(cellClasses(cell('2026-09-28', { inMonth: false }))).toContain('text-muted-foreground');
    expect(cellClasses(cell('2026-10-02'))).toContain('text-foreground');
    expect(cellClasses(cell('2026-10-02'))).not.toContain('text-muted-foreground');
  });
});

describe('an event line', () => {
  const lineFor = (ids: string[], profiles: Profile[] = FAMILY, more: Partial<Occurrence> = {}) => cell('2026-10-01', { occurrences: [event('Standup', ids, more)], profiles });

  it("is one flat band in a Profile's own fill for an event for one Profile", () => {
    const html = lineFor(['p-ava']);
    expect(count(html, 'bg-person-fill')).toBe(1);
    expect(html).toContain('class="person flex-1 bg-person-fill"');
    for (const [name, value] of Object.entries(personStyle(AVA.color))) expect(html).toContain(`${name}:${value}`);
  });

  it('is equal bands, one for each of two or three Profiles, in Profile order', () => {
    const two = lineFor(['p-ava', 'p-cory']);
    expect(count(two, 'bg-person-fill')).toBe(2);
    expect(two.indexOf(step300(CORY))).toBeGreaterThan(-1);
    expect(two.indexOf(step300(CORY))).toBeLessThan(two.indexOf(step300(AVA)));
    expect(count(lineFor(['p-cory', 'p-sam', 'p-ava']), 'bg-person-fill')).toBe(3);
  });

  it('is --everyone, with no person in it, for the whole Household: no Profile, or every Profile of two or more', () => {
    for (const ids of [[], ['p-cory', 'p-sam', 'p-ava', 'p-ben']]) {
      const html = lineFor(ids);
      expect(html, ids.join()).toContain('bg-everyone');
      expect(html, ids.join()).not.toContain('bg-person-fill');
    }
  });

  it("is the Profile's own fill in a Household of one Profile, and --everyone only for an event with none", () => {
    expect(lineFor(['p-cory'], [CORY])).toContain('bg-person-fill');
    expect(lineFor(['p-cory'], [CORY])).not.toContain('bg-everyone');
    expect(lineFor([], [CORY])).toContain('bg-everyone');
  });

  it("never draws a Mirrored Calendar's colour, whatever the view says, and has no coloured edge", () => {
    for (const ids of [[], ['p-ava'], ['p-cory', 'p-sam']]) {
      const html = lineFor(ids);
      expect(html).not.toContain('#ff0000');
      expect(html).not.toContain('#00ff00');
      expect(html).not.toContain('border-l');
      expect(html).not.toContain('gradient');
    }
  });

  it("has its words in --foreground, never in a person's colour", () => {
    for (const ids of [[], ['p-ava'], ['p-cory', 'p-sam']]) {
      const classes = classesOf(lineTag(lineFor(ids)));
      expect(classes, ids.join()).toContain('text-foreground');
      expect(classes.filter((name) => name.startsWith('text-person') || name.startsWith('text-ink')), ids.join()).toEqual([]);
    }
    expect(lineTag(lineFor(['p-ava']))).not.toContain('style=');
  });

  it('says its start time without ":00", but nothing for an all-day event or one that began on an earlier day', () => {
    expect(lineFor(['p-cory'])).toContain('>9 AM<');
    const allDay = event('Photo day', [], { is_all_day: true, starts_at: '2026-10-01T05:00:00Z', ends_at: '2026-10-02T05:00:00Z' });
    expect(cell('2026-10-01', { occurrences: [allDay] })).not.toContain(' AM<');
    const camping = event('Camping', [], { starts_at: '2026-10-01T14:00:00Z', ends_at: '2026-10-02T15:00:00Z' });
    expect(cell('2026-10-02', { occurrences: [camping] })).not.toContain(' AM<');
  });

  it('has the pin before the title of a Native Event, and no pin on a Synced Event', () => {
    const html = cell('2026-10-01', { occurrences: [native('Plumber coming')] });
    expect(html).toContain('data-testid="native-mark"');
    expect(html.indexOf('native-mark')).toBeLessThan(html.indexOf('Plumber coming'));
    expect(lineFor(['p-cory'])).not.toContain('native-mark');
  });

  it('stays one line, cut short with an ellipsis, and can never push its cell wider', () => {
    const title = 'x'.repeat(200);
    const html = cell('2026-10-01', { occurrences: [native(title, ['p-ava'])] });
    expect(spanWith(html, title)).toEqual(expect.arrayContaining(['truncate', 'min-w-0']));
    expect(classesOf(lineTag(html))).toEqual(expect.arrayContaining(['flex', 'min-w-0', 'overflow-hidden', 'h-5.5']));
    expect(html).not.toContain('line-clamp');
    expect(html).not.toContain('whitespace-normal');
    expect(html).not.toContain('break-all');
  });

  it('is not drawn until its week has been read, and each is when it has', () => {
    expect(count(cell('2026-10-01', { occurrences: null }), 'data-testid="event-line"')).toBe(0);
    expect(count(cell('2026-10-01', { occurrences: [event('A', []), event('B', []), event('C', [])] }), 'data-testid="event-line"')).toBe(3);
  });
});

describe('what a cell says of the events it has no line for', () => {
  const crowded = (lines: number) => cell('2026-10-01', { occurrences: ['A', 'B', 'C', 'D', 'E'].map((title) => event(title, [])), lines });

  it('says "+N more" under the lines, inside the button so a tap on it opens the day, in words no smaller than 14 px', () => {
    const html = crowded(3);
    expect(count(html, 'data-testid="event-line"')).toBe(2);
    expect(html).toContain('+3 more');
    expect(html.indexOf('+3 more')).toBeGreaterThan(html.lastIndexOf('data-testid="event-line"'));
    expect(html.indexOf('+3 more')).toBeLessThan(html.indexOf('</button>'));
    expect(spanWith(html, '+3 more')).toContain('text-sm');
    expect(spanWith(html, '+3 more')).not.toContain('text-xs');
  });

  it('says how many events there are when only one line fits', () => {
    const html = crowded(1);
    expect(count(html, 'data-testid="event-line"')).toBe(0);
    expect(html).toContain('>5 events<');
  });
});

describe("a day beyond the calendar's range", () => {
  const beyond = () => cell('2026-10-02', { occurrences: null, beyond: true });

  it('is not a button, as there is nothing to open, and says so to a screen reader', () => {
    expect(beyond()).not.toContain('<button');
    expect(beyond()).toMatch(/Beyond the calendar(&#x27;|')s range/);
  });

  it('has a hatch drawn in --input, which look.test.ts holds to 3:1 on the card in both modes, and not in the hairline colour', () => {
    const html = beyond();
    expect(html).toContain('repeating-linear-gradient');
    expect(html).toContain('var(--input)');
    expect(html).not.toContain('var(--border)');
  });

  it('draws it in a colour that is at least 3:1 against the cell, which is the card, in both modes', () => {
    for (const mode of ['light', 'dark'] as Mode[]) {
      expect(contrastRatio(TOKENS[mode].input, TOKENS[mode].card), mode).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps its date on a --card ground, so the hatch never runs under the digits', () => {
    expect(spanWith(beyond(), '2')).toEqual(expect.arrayContaining(['bg-card', 'rounded-full', 'font-display']));
  });

  it('draws no event line, whatever it is given', () => {
    expect(count(cell('2026-10-02', { occurrences: [event('A', [])], beyond: true }), 'data-testid="event-line"')).toBe(0);
  });
});
