import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EventDiscs, EventFill, EventPill } from '../src/components/EventPill';
import { fiveDays, type Occurrence } from '../src/lib/calendar-occurrences';
import { personStyle } from '../src/lib/look';
import type { Profile } from '../src/lib/profiles';
import { pillName, pillPeople, scheduleColumns, type PillPeople } from '../src/lib/schedule';

// The event pill and its parts rendered to markup (as tests/people.test.ts does for the atoms), so what is asserted is what the
// browser is given: the fill is one flat band for each of up to three Profiles in their own colours, the whole Household's is
// --everyone, the discs overlap two at a time and then count the rest, a Native Event has its pin before its title, and only
// the event that is on now has the ring.

const CHICAGO = 'America/Chicago';
// Thu Oct 1, 2026, 7:21 PM in Chicago.
const NOW = new Date('2026-10-02T00:21:00Z');
const [TODAY] = fiveDays(CHICAGO, NOW);

const profile = (id: string, name: string, sort: number, color: string): Profile => ({ id, name, color, avatar_url: null, sort_order: sort });
const CORY = profile('p-cory', 'Cory', 0, '#93c5fd');
const SAM = profile('p-sam', 'Sam', 1, '#f9a8d4');
const AVA = profile('p-ava', 'Ava', 2, '#fcd34d');
const BEN = profile('p-ben', 'Ben', 3, '#6ee7b7');
const EMMA = profile('p-emma', 'Emma', 4, '#c4b5fd');
const FAMILY = [CORY, SAM, AVA, BEN, EMMA];

function event(title: string, profileIds: string[], more: Partial<Occurrence> = {}): Occurrence {
  return {
    source: 'synced',
    id: `event-${title}`,
    calendar_id: 'calendar-1',
    calendar_name: 'Family',
    title,
    description: null,
    location: null,
    // 6:30 PM to 8:00 PM on Oct 1, Chicago: on now at 7:21 PM.
    starts_at: '2026-10-01T23:30:00Z',
    ends_at: '2026-10-02T01:00:00Z',
    is_all_day: false,
    profile_id: profileIds[0] ?? null,
    // The Mirrored Calendar's colours, which a pill never draws.
    color: '#ff0000',
    profile_ids: profileIds,
    colors: ['#ff0000', '#00ff00'],
    ...more,
  };
}

const people = (occurrence: Occurrence): PillPeople => pillPeople(occurrence, FAMILY);
const count = (html: string, text: string) => html.split(text).length - 1;
// The 300 step a Profile's element carries, which only that Profile's own colour can put in the markup.
const step300 = (who: Profile) => (personStyle(who.color) as Record<string, string>)['--person-300']!;

function pill(occurrence: Occurrence, now = NOW): string {
  const [column] = scheduleColumns([occurrence], [TODAY!], now);
  return renderToStaticMarkup(createElement(EventPill, { pill: column!.pills[0]!, day: TODAY!, people: people(occurrence), onOpen: () => undefined }));
}

describe('the fill of an event', () => {
  const fill = (ids: string[]) => renderToStaticMarkup(createElement(EventFill, { people: people(event('Meeting', ids)) }));

  it('is one band in a Profile\'s own fill for an event for one Profile', () => {
    const html = fill(['p-ava']);
    expect(count(html, 'bg-person-fill')).toBe(1);
    expect(html).toContain('class="person flex-1 bg-person-fill"');
    for (const [name, value] of Object.entries(personStyle(AVA.color))) expect(html).toContain(`${name}:${value}`);
  });

  it('is equal bands, one for each of two or three Profiles, in Profile order', () => {
    const html = fill(['p-ava', 'p-cory']);
    expect(count(html, 'bg-person-fill')).toBe(2);
    expect(html.indexOf(step300(CORY))).toBeGreaterThan(-1);
    expect(html.indexOf(step300(CORY))).toBeLessThan(html.indexOf(step300(AVA)));
    expect(count(fill(['p-cory', 'p-sam', 'p-ava']), 'bg-person-fill')).toBe(3);
  });

  it('is the first three bands for more than three Profiles', () => {
    const html = fill(['p-cory', 'p-sam', 'p-ava', 'p-ben']);
    expect(count(html, 'bg-person-fill')).toBe(3);
    expect(html).not.toContain(step300(BEN));
  });

  it('is --everyone, with no person in it, for the whole Household', () => {
    for (const ids of [[], ['p-cory', 'p-sam', 'p-ava', 'p-ben', 'p-emma']]) {
      const html = fill(ids);
      expect(html).toContain('bg-everyone');
      expect(html).not.toContain('person');
    }
  });

  it('never draws a Mirrored Calendar\'s colour, whatever the view says', () => {
    for (const ids of [[], ['p-ava'], ['p-cory', 'p-sam']]) {
      const html = fill(ids);
      expect(html).not.toContain('#ff0000');
      expect(html).not.toContain('#00ff00');
    }
  });

  it('is flat bands, never a gradient, and never a coloured side border', () => {
    const html = fill(['p-cory', 'p-sam']);
    expect(html).not.toContain('gradient');
    expect(html).not.toContain('border-l');
  });
});

describe('who an event is for, at the right of its pill', () => {
  const discs = (ids: string[]) => renderToStaticMarkup(createElement(EventDiscs, { people: people(event('Meeting', ids)) }));

  it('is the house disc for the whole Household', () => {
    expect(discs([])).toContain('bg-primary');
    expect(discs([])).not.toContain('person');
  });

  it('is one disc with the person\'s initial for one Profile', () => {
    const html = discs(['p-ava']);
    expect(count(html, 'bg-person-strong')).toBe(1);
    expect(html).toContain('>A<');
    expect(html).not.toContain('+');
  });

  it('is two discs, overlapping by 4 px, for two Profiles', () => {
    const html = discs(['p-cory', 'p-sam']);
    expect(count(html, 'bg-person-strong')).toBe(2);
    expect(html).toMatch(/["\s]-ml-1["\s]/);
    expect(html).not.toContain('-ml-1.5');
    expect(html).not.toContain('-ml-2');
  });

  it('is a disc for the first Profile and a "+N" disc that counts the rest for three or more, never more than two discs wide', () => {
    const three = discs(['p-cory', 'p-sam', 'p-ava']);
    expect(count(three, 'bg-person-strong')).toBe(1);
    expect(three).toContain('>C<');
    expect(three).not.toContain('>S<');
    expect(three).toContain('+2');
    expect(three).toMatch(/["\s]-ml-1["\s]/);
    const four = discs(['p-cory', 'p-sam', 'p-ava', 'p-ben']);
    expect(count(four, 'bg-person-strong')).toBe(1);
    expect(four).toContain('+3');
  });

  it('is hidden from a screen reader, the pill\'s own name says who', () => {
    expect(discs(['p-cory', 'p-sam'])).toContain('aria-hidden="true"');
  });
});

describe('an event pill', () => {
  it('is named for a screen reader by its title, who, the day and the time, and ends "added here" for a Native Event', () => {
    const native = event('Plumber coming', [], { source: 'native', calendar_id: null, calendar_name: 'Nidus' });
    const html = pill(native);
    const [column] = scheduleColumns([native], [TODAY!], NOW);
    const name = pillName(column!.pills[0]!, TODAY!, people(native));
    expect(name).toBe('Plumber coming, everyone, Thursday, October 1, 6:30 PM, on now, added here');
    expect(html).toContain(`aria-label="${name}"`);
  });

  it('says which event it is, so focus can be put back on it when a sheet it opened has closed', () => {
    expect(pill(event('Piano', ['p-ava']))).toContain('data-event="event-Piano"');
  });

  it('has the pin before the title of a Native Event, and no pin on a Synced Event', () => {
    const native = pill(event('Plumber coming', [], { source: 'native', calendar_id: null, calendar_name: 'Nidus' }));
    expect(native).toContain('data-testid="native-mark"');
    expect(native.indexOf('native-mark')).toBeLessThan(native.indexOf('Plumber coming</span>'));
    expect(pill(event('Standup', ['p-cory']))).not.toContain('native-mark');
  });

  it('has the ring only when it is on now', () => {
    const ring = 'shadow-[inset_0_0_0_2.5px_var(--foreground)]';
    expect(pill(event('Family dinner', []))).toContain(ring);
    // The same event an hour before it starts, and an all-day event, have none.
    expect(pill(event('Family dinner', []), new Date('2026-10-01T22:00:00Z'))).not.toContain(ring);
    expect(pill(event('Photo day', [], { is_all_day: true, starts_at: '2026-10-01T05:00:00Z', ends_at: '2026-10-02T05:00:00Z' }))).not.toContain(ring);
  });

  it('never has the ring when it says "All day", also for a timed event that covers all of today and is on now', () => {
    const ring = 'shadow-[inset_0_0_0_2.5px_var(--foreground)]';
    const covering = pill(event('Road trip', ['p-sam'], { starts_at: '2026-09-30T01:00:00Z', ends_at: '2026-10-03T08:00:00Z' }));
    expect(covering).toContain('All day');
    expect(covering).not.toContain(ring);
    // The first day of the same event says its start time, and does have the ring while it is on.
    const [first] = fiveDays(CHICAGO, new Date('2026-09-30T02:00:00Z'));
    const [column] = scheduleColumns([event('Road trip', ['p-sam'], { starts_at: '2026-09-30T01:00:00Z', ends_at: '2026-10-03T08:00:00Z' })], [first!], new Date('2026-09-30T02:00:00Z'));
    const firstDay = renderToStaticMarkup(createElement(EventPill, { pill: column!.pills[0]!, day: first!, people: people(event('Road trip', ['p-sam'])), onOpen: () => undefined }));
    expect(firstDay).toContain('8:00');
    expect(firstDay).toContain(ring);
  });

  it('puts the title on up to two lines that end in an ellipsis, never breaking inside a word, and is at least 52 px tall', () => {
    const html = pill(event('Orthodontist appointment', ['p-ava']));
    expect(html).toContain('line-clamp-2');
    expect(html).toContain('text-ellipsis');
    expect(html).not.toContain('break-all');
    expect(html).not.toContain('break-words');
    expect(html).not.toContain('overflow-wrap');
    expect(html).toContain('min-h-13');
  });

  it('says when it ended, for the column to read with its height, only when it has', () => {
    // Standup was 9:00 to 9:30 AM, over at 7:21 PM; the Family dinner is on now.
    const over = pill(event('Standup', ['p-cory'], { starts_at: '2026-10-01T14:00:00Z', ends_at: '2026-10-01T14:30:00Z' }));
    expect(over).toContain(`data-ended-at="${Date.parse('2026-10-01T14:30:00Z')}"`);
    expect(pill(event('Family dinner', []))).not.toContain('data-ended-at');
  });

  it('says the time under the title, with the AM or PM held to the time', () => {
    expect(pill(event('Family dinner', []))).toContain('6:30\u00a0PM');
  });

  it('draws the fill and the discs of the Profiles it is for', () => {
    const html = pill(event('Soccer practice', ['p-ava', 'p-ben']));
    expect(count(html, 'bg-person-fill')).toBe(2);
    expect(count(html, 'bg-person-strong')).toBe(2);
  });

  it('is the Profile\'s own fill and disc in a Household of one Profile, and the whole Household\'s only for an event with none', () => {
    const inAHouseholdOfOne = (occurrence: Occurrence) => {
      const [column] = scheduleColumns([occurrence], [TODAY!], NOW);
      return renderToStaticMarkup(createElement(EventPill, { pill: column!.pills[0]!, day: TODAY!, people: pillPeople(occurrence, [CORY]), onOpen: () => undefined }));
    };
    const hers = inAHouseholdOfOne(event('Standup', ['p-cory']));
    expect(count(hers, 'bg-person-fill')).toBe(1);
    expect(count(hers, 'bg-person-strong')).toBe(1);
    expect(hers).toContain('>C<');
    expect(hers).not.toContain('bg-everyone');
    expect(hers).toContain('aria-label="Standup, Cory, ');
    const nobody = inAHouseholdOfOne(event('Family dinner', []));
    expect(nobody).toContain('bg-everyone');
    expect(nobody).toContain('bg-primary');
    expect(nobody).not.toContain('bg-person-fill');
  });

  // The title has the whole width of the pill; under it is one row, the time at the left and who it is for at the right.
  describe('its layout', () => {
    const rowOf = (html: string) => html.slice(html.indexOf('flex-wrap'));
    const aboveTheRow = (html: string) => html.slice(0, html.indexOf('flex-wrap'));

    it('puts the title alone above the time and the discs, so no disc takes a share of its width', () => {
      for (const ids of [[], ['p-ava'], ['p-ava', 'p-ben'], ['p-cory', 'p-sam', 'p-ava', 'p-ben']]) {
        const html = pill(event('Thanksgiving', ids));
        expect(html.indexOf('flex-wrap'), `${ids.length} people`).toBeGreaterThan(-1);
        expect(aboveTheRow(html)).toContain('Thanksgiving');
        expect(aboveTheRow(html)).toContain('line-clamp-2');
        expect(aboveTheRow(html)).not.toContain('bg-primary');
        expect(aboveTheRow(html)).not.toContain('bg-person-strong');
        expect(rowOf(html)).toContain('6:30');
        expect(rowOf(html)).toMatch(ids.length === 0 ? /bg-primary/ : /bg-person-strong/);
        expect(rowOf(html)).not.toContain('Thanksgiving');
      }
    });

    it('stacks its parts, and keeps the discs to the right when the row wraps', () => {
      const html = pill(event('Thanksgiving', ['p-ava', 'p-ben']));
      expect(html).toContain('flex-col');
      expect(rowOf(html)).toContain('ml-auto');
      expect(rowOf(html)).toContain('items-center');
    });

    it('is still at least 52 px tall', () => {
      expect(pill(event('Thanksgiving', ['p-ava']))).toContain('min-h-13');
    });
  });
});
