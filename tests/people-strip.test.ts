import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PeopleStrip } from '../src/components/PeopleStrip';
import { createProfileFilter } from '../src/lib/profile-filter';
import type { Profile } from '../src/lib/profiles';
import type { ProfileRoutines, Routine } from '../src/lib/routines';
import type { RoutinesToday } from '../src/lib/use-routines-today';

// The people strip rendered to markup: who is on it and in what order, what is pressed, what the one-Profile Household
// gets, and the words and pips of each person's Routines. The pill's room (the shrinking, the scrolling) is the browser's
// and is looked at there; what is asserted is what the browser is given.

const profile = (id: string, name: string, sort: number, color: string): Profile => ({ id, name, color, avatar_url: null, sort_order: sort });
const CORY = profile('p-cory', 'Cory', 0, '#93c5fd');
const SAM = profile('p-sam', 'Sam', 1, '#f9a8d4');
const AVA = profile('p-ava', 'Ava', 2, '#fcd34d');
const BEN = profile('p-ben', 'Ben', 3, '#6ee7b7');
const FAMILY = [CORY, SAM, AVA, BEN];

const routines = (who: Profile, count: number): Routine[] =>
  Array.from({ length: count }, (_, index) => ({ id: `${who.id}-${index}`, profile_id: who.id, title: `Routine ${index}`, days_of_week: 127, time_of_day: null, sort_order: index, archived_at: null, picture: null }));
const group = (who: Profile, count: number): ProfileRoutines => ({ profile: who, routines: routines(who, count) });
const ticked = (who: Profile, count: number) => routines(who, count).map((routine) => routine.id);

function today(groups: ProfileRoutines[], done: string[] = []): RoutinesToday {
  return { date: '2026-10-01', loaded: true, settled: true, failed: false, part: 'evening', problems: {}, groups, columns: groups, done: new Set(done), finished: new Set(), toggle: async () => true };
}

function strip(profiles: Profile[] | null, groups: ProfileRoutines[] = [], done: string[] = [], pressed: string[] = []): string {
  return renderToStaticMarkup(createElement(PeopleStrip, { profiles, routines: today(groups, done), filter: createProfileFilter(), pressed }));
}

// The markup of one person's pill: from its button to the next button's start.
function pillOf(html: string, name: string): string {
  const start = html.indexOf(`aria-label="${name}`);
  expect(start, `a pill for ${name}`).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf('<button', start), html.indexOf('</button>', start));
}

describe('the people strip', () => {
  it('keeps the row\'s height while the Profiles are read, and is nothing for a Household that has none', () => {
    expect(strip(null)).toBe('<div class="h-14"></div>');
    expect(strip([])).toBe('');
  });

  it('is a group named for what it does: Everyone, then a pill for each Profile in the Profiles\' order', () => {
    const html = strip(FAMILY);
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Show events for"');
    const at = ['Everyone', 'aria-label="Cory', 'aria-label="Sam', 'aria-label="Ava', 'aria-label="Ben'].map((text) => html.indexOf(text));
    expect(at.every((index) => index > -1)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('has Everyone pressed while nothing is, and only the pressed person pressed after a press', () => {
    const none = strip(FAMILY);
    expect(none.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(none.indexOf('aria-pressed="true"')).toBeLessThan(none.indexOf('aria-label="Cory'));
    const sam = strip(FAMILY, [], [], ['p-sam']);
    expect(sam.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(pillOf(sam, 'Sam')).toContain('aria-pressed="true"');
    expect(pillOf(sam, 'Cory')).toContain('aria-pressed="false"');
    expect(sam.slice(0, sam.indexOf('Everyone'))).toContain('aria-pressed="false"');
  });

  it('shows a tick in the pressed person\'s disc, in place of the initial, and the initial on the others', () => {
    const html = strip(FAMILY, [], [], ['p-sam']);
    expect(pillOf(html, 'Sam')).toContain('lucide-check');
    expect(pillOf(html, 'Sam')).not.toContain('>S<');
    expect(pillOf(html, 'Cory')).toContain('>C<');
    expect(pillOf(html, 'Cory')).not.toContain('lucide-check');
  });

  it('draws each person on their soft colour, in their own', () => {
    const html = strip(FAMILY);
    expect(pillOf(html, 'Ava')).toContain('bg-person-soft');
    expect(pillOf(html, 'Ava')).toContain('--person-300:#FCD34D');
  });

  it('gives a pill the width of its name as its least, so a long name scrolls the row instead of being cut to its first letters', () => {
    const html = strip([CORY, profile('p-bart', 'Bartholomew', 1, '#f9a8d4'), profile('p-x', 'Maximilian-Alexander-Wellington', 2, '#fcd34d')]);
    expect(pillOf(html, 'Cory')).toContain('min-width:max(8rem, min(19rem, calc(4ch + 4.5rem)))');
    expect(pillOf(html, 'Bartholomew')).toContain('calc(11ch + 4.5rem)');
    // The widest a pill goes is where a name is cut, however long.
    expect(pillOf(html, 'Maximilian')).toContain('min(19rem, calc(31ch + 4.5rem))');
  });

  describe('with one Profile', () => {
    const html = strip([AVA], [group(AVA, 5)], ticked(AVA, 3));

    it('has no Everyone', () => {
      expect(html).not.toContain('Everyone');
    });

    it('is a pill that does not filter: no button, nothing pressed to press', () => {
      expect(html).not.toContain('<button');
      expect(html).not.toContain('aria-pressed');
    });

    it('still shows the progress', () => {
      expect(html).toContain('>Ava<');
      expect(html).toContain('3 of 5');
      expect(html).toContain('role="progressbar"');
    });
  });
});

describe('the Routines on a person\'s pill', () => {
  const html = strip(FAMILY, [group(CORY, 1), group(AVA, 5), group(BEN, 3)], [...ticked(CORY, 1), ...ticked(AVA, 3), ...ticked(BEN, 2)]);

  it('is "3 of 5" and a pip for each Routine, filled for each one done', () => {
    const ava = pillOf(html, 'Ava');
    expect(ava).toContain('3 of 5');
    expect(ava).toContain('aria-valuenow="3"');
    expect(ava).toContain('aria-valuemax="5"');
    expect(ava.split('bg-person-strong').length - 1).toBe(1 + 3);
  });

  it('is "All done" once every one is ticked', () => {
    expect(pillOf(html, 'Cory')).toContain('All done');
    expect(pillOf(html, 'Cory')).not.toContain('>1 of 1<');
  });

  it('is nothing at all, not even "0 of 0", for a person with none today', () => {
    const sam = pillOf(html, 'Sam');
    expect(sam).not.toContain(' of ');
    expect(sam).not.toContain('All done');
    expect(sam).not.toContain('progressbar');
  });

  it('is the count alone past eight Routines: no pips', () => {
    const nine = strip(FAMILY, [group(AVA, 9)], ticked(AVA, 3));
    expect(pillOf(nine, 'Ava')).toContain('3 of 9');
    expect(pillOf(nine, 'Ava')).not.toContain('progressbar');
    const eight = strip(FAMILY, [group(AVA, 8)], ticked(AVA, 3));
    expect(pillOf(eight, 'Ava')).toContain('progressbar');
  });

  it('names the pill for a screen reader with the progress, since a button\'s own parts are not read apart', () => {
    expect(pillOf(html, 'Ava')).toContain('aria-label="Ava, 3 of 5 routines done"');
    expect(pillOf(html, 'Cory')).toContain('aria-label="Cory, 1 of 1 routine done"');
    expect(pillOf(html, 'Sam')).toContain('aria-label="Sam"');
  });
});
