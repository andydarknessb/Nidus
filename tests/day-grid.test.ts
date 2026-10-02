import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { offsetMs } from '../supabase/functions/_shared/zoned-time.ts';
import { ClusterList } from '../src/components/ClusterList';
import { HourGrid, PillRow } from '../src/components/DayGrid';
import { addDays, dayStartMs, pageDays, type Occurrence } from '../src/lib/calendar-occurrences';
import { planDay, type DayPlan } from '../src/lib/day-view';
import type { Profile } from '../src/lib/profiles';
import type { OverflowControl } from '../src/lib/use-overflow';
import { scrollers } from './support/markup';

// What the Day view draws, rendered to markup (as tests/event-pill.test.ts does for the pill), so what is asserted is what the
// browser is given: an hour is 3 rem, a block is never under one, the now line is drawn under the blocks, only the event that is on
// now has the ring, a block is filled from its people and never from the Mirrored Calendar's colour, two lanes with a "+N" for the
// rest, and both rows keep their height whether they hold pills or not, and say when they scroll.

const CHICAGO = 'America/Chicago';
const OCT1 = '2026-10-01';
const OCT2 = '2026-10-02';

const profile = (id: string, name: string, sort: number, color: string): Profile => ({ id, name, color, avatar_url: null, sort_order: sort });
const CORY = profile('p-cory', 'Cory', 0, '#93c5fd');
const SAM = profile('p-sam', 'Sam', 1, '#f9a8d4');
const AVA = profile('p-ava', 'Ava', 2, '#fcd34d');
const FAMILY = [CORY, SAM, AVA];

function wall(date: string, time: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  return naive - offsetMs(naive - offsetMs(naive, CHICAGO), CHICAGO);
}

let counter = 0;
function event(title: string, date: string, from: string, to: string, ids: string[] = [], more: Partial<Occurrence> = {}): Occurrence {
  counter += 1;
  return {
    source: 'synced',
    id: `event-${counter}`,
    calendar_id: 'calendar-1',
    calendar_name: 'Family',
    title,
    description: null,
    location: null,
    starts_at: new Date(wall(date, from)).toISOString(),
    ends_at: new Date(wall(date, to)).toISOString(),
    is_all_day: false,
    profile_id: ids[0] ?? null,
    // The Mirrored Calendar's colours, which a block never draws.
    color: '#ff0000',
    profile_ids: ids,
    colors: ['#ff0000'],
    ...more,
  };
}

// Thu Oct 1, 2026, 7:21 PM in Chicago.
const NOW = new Date(wall(OCT1, '19:21'));
const dayOf = (date: string) => pageDays('day', date, CHICAGO, NOW)[0]!;

function plan(occurrences: Occurrence[], date = OCT1): DayPlan {
  return planDay({ occurrences, day: dayOf(date), now: NOW, fit: 8 });
}
const grid = (p: DayPlan, date = OCT1) => renderToStaticMarkup(createElement(HourGrid, { plan: p, day: dayOf(date), people: FAMILY, onOpen: () => undefined, onFold: () => undefined }));
// What a row's scrolling box says, as the hook would hand it over (markup is made without the browser's measuring): by default that
// it holds all it has.
const says = (overflowing = false, atEnd = false): OverflowControl => ({ axis: 'x', overflowing, atEnd, scroller: () => undefined, piece: () => undefined, step: () => undefined });
const count = (html: string, text: string) => html.split(text).length - 1;
// The opening tag of the button named `name` (a name that starts so), and all of that button.
const literally = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const block = (html: string, name: string) => new RegExp(`<button[^>]*aria-label="${literally(name)}[^"]*"[^>]*>`).exec(html)?.[0] ?? '';
const inner = (html: string, name: string) => new RegExp(`<button[^>]*aria-label="${literally(name)}[^"]*"[^>]*>[\\s\\S]*?</button>`).exec(html)?.[0] ?? '';

describe('the grid', () => {
  it('is 3 rem an hour: a hairline at each hour but the first, and a label at each', () => {
    const html = grid(plan([]));
    // 4 PM to midnight: eight hours, 24 rem.
    expect(html).toContain('style="height:24rem"');
    expect(count(html, 'h-px bg-border')).toBe(7);
    for (const rem of [3, 6, 9, 12, 15, 18, 21]) expect(html).toContain(`top:${rem}rem`);
    expect(html).not.toContain('top:24rem');
    for (const label of ['4 PM', '5 PM', '6 PM', '7 PM', '8 PM', '9 PM', '10 PM', '11 PM']) expect(html).toContain(`>${label}<`);
    expect(html).not.toContain('>12 AM<');
  });

  it('makes the box of an hour-long event exactly an hour tall, and the box of one shorter than an hour an hour tall too', () => {
    const html = grid(plan([event('Book club', OCT1, '20:00', '21:00'), event('Piano', OCT1, '16:00', '16:45')]));
    // One hour is 3 rem, and the box is the target: never under it, and never shortened to make a gap.
    expect(block(html, 'Book club')).toContain('height:max(3rem, 3rem)');
    expect(block(html, 'Piano')).toContain('height:max(3rem, 3rem)');
  });

  it('makes the box of a longer event as tall as it lasts', () => {
    const html = grid(plan([event('Family dinner', OCT1, '18:30', '20:00')]));
    expect(block(html, 'Family dinner')).toContain('top:7.5rem');
    expect(block(html, 'Family dinner')).toContain('height:max(3rem, 4.5rem)');
  });

  it('draws the fill and the ring of every block 2 px short of its box, so blocks that follow each other never read as one', () => {
    // Piano and Swim are both Ava's and follow each other: their boxes touch (3 rem and 3 rem further down), their fills do not.
    const html = grid(plan([event('Piano', OCT1, '16:00', '17:00', ['p-ava']), event('Swim', OCT1, '17:00', '18:00', ['p-ava']), event('Family dinner', OCT1, '18:30', '20:00')]));
    expect(block(html, 'Piano')).toContain('top:0rem');
    expect(block(html, 'Swim')).toContain('top:3rem');
    for (const title of ['Piano', 'Swim', 'Family dinner']) {
      const inside = inner(html, title);
      // The fill is a box of its own inside the target, short of its bottom by 2 px; the target itself is not painted.
      expect(inside, title).toMatch(/<span[^>]*class="[^"]*\binset-x-0 top-0 bottom-0\.5\b[^"]*"[^>]*><span[^>]*><span[^>]*bg-(person-fill|everyone)/);
      // So the words sit on the middle of the fill, not of the target.
      expect(block(html, title), title).toMatch(/class="[^"]*\bpb-0\.5\b/);
    }
    // The ring of the event that is on now is drawn short too: in the same box as the fill.
    expect(count(inner(html, 'Family dinner'), 'top-0 bottom-0.5')).toBe(2);
    expect(count(inner(html, 'Piano'), 'top-0 bottom-0.5')).toBe(1);
  });

  it('fills a block from its people and never from the calendar it came from', () => {
    const html = grid(plan([event('Piano', OCT1, '16:00', '17:00', ['p-ava']), event('Dinner', OCT1, '18:00', '19:00'), event('Swim', OCT1, '20:00', '21:00', ['p-cory', 'p-sam'])]));
    expect(count(html, 'bg-person-fill')).toBe(3);
    expect(count(html, 'bg-everyone')).toBe(1);
    expect(html).not.toContain('#ff0000');
    expect(html).not.toContain('255, 0, 0');
  });

  it('says what each block is: its title, its time, and who it is for', () => {
    const html = grid(plan([event('Piano', OCT1, '16:00', '16:45', ['p-ava'])]));
    expect(html).toContain('aria-label="Piano, Ava, Thursday, October 1, 4:00 to 4:45 PM"');
    expect(html).toContain('>4:00 to 4:45 PM<');
  });

  it('says which event each block is, so focus can be put back on it when a sheet it opened has closed', () => {
    const piano = event('Piano', OCT1, '16:00', '17:00');
    expect(block(grid(plan([piano])), 'Piano')).toContain(`data-event="${piano.id}"`);
  });

  it('pins a Native Event before its title', () => {
    const html = grid(plan([event('Plumber coming', OCT1, '20:00', '21:00', [], { source: 'native', calendar_id: null, calendar_name: 'Nidus' })]));
    expect(count(html, 'data-testid="native-mark"')).toBe(1);
    expect(html).toContain('added here');
  });

  it('draws the now line under the blocks, so it never crosses a title', () => {
    const html = grid(plan([event('Family dinner', OCT1, '18:30', '20:00')]));
    expect(count(html, 'data-testid="now-line"')).toBe(1);
    expect(html.indexOf('data-testid="now-line"')).toBeLessThan(html.indexOf('<button'));
    // 7:21 PM is 3.35 hours into a grid that starts at 4 PM.
    expect(html).toContain('top:10.05');
    // It is behind: nothing about it asks for a place above the blocks.
    expect(html).not.toMatch(/data-testid="now-line"[^>]*z-/);
  });

  it('has no now line on another day', () => {
    expect(count(grid(plan([], OCT2), OCT2), 'data-testid="now-line"')).toBe(0);
  });

  it('rings only the timed event that is on now', () => {
    const ring = 'shadow-[inset_0_0_0_2.5px_var(--foreground)]';
    const html = grid(plan([event('Family dinner', OCT1, '18:30', '20:00'), event('Piano', OCT1, '16:00', '16:45'), event('Book club', OCT1, '20:00', '21:00')]));
    expect(count(html, ring)).toBe(1);
    expect(count(html, '>On now<')).toBe(1);
    expect(html.indexOf(ring)).toBeGreaterThan(html.indexOf('Family dinner'));
    expect(html.indexOf(ring)).toBeLessThan(html.indexOf('Book club'));
    // An all-day event never has it: it is in the row above, and says "All day".
    const allDay = event('Photo day', OCT1, '00:00', '00:00', [], { is_all_day: true, ends_at: new Date(dayStartMs(addDays(OCT1, 1), CHICAGO)).toISOString(), starts_at: new Date(dayStartMs(OCT1, CHICAGO)).toISOString() });
    const row = renderToStaticMarkup(createElement(PillRow, { label: 'Earlier', name: 'All day and earlier', of: 'earlier events', control: says(), pills: plan([allDay]).above, day: dayOf(OCT1), people: FAMILY, empty: '', onOpen: () => undefined }));
    expect(count(row, ring)).toBe(0);
  });
});

describe('the lanes', () => {
  it('give two overlapping events half the width each, 8 px apart', () => {
    const html = grid(plan([event('Soccer', OCT1, '16:00', '18:00', ['p-ava']), event('Piano', OCT1, '17:00', '18:00', ['p-sam'])]));
    expect(block(html, 'Soccer')).toContain('left:0');
    expect(block(html, 'Soccer')).toContain('width:calc(50% - 4px)');
    expect(block(html, 'Piano')).toContain('left:calc(50% + 4px)');
    expect(block(html, 'Piano')).toContain('width:calc(50% - 4px)');
  });

  it('give an event alone the whole width', () => {
    const html = grid(plan([event('Soccer', OCT1, '16:00', '18:00')]));
    expect(block(html, 'Soccer')).toContain('width:100%');
  });

  it('draw a third and more as one "+N" at the right of the second lane, and leave it room', () => {
    const html = grid(plan([event('A', OCT1, '16:00', '17:00'), event('B', OCT1, '16:00', '17:00'), event('C', OCT1, '16:00', '17:00')]));
    // Two blocks are drawn; the third is the tile.
    expect(count(html, 'aria-label="A,')).toBe(1);
    expect(count(html, 'aria-label="B,')).toBe(1);
    expect(count(html, 'aria-label="C,')).toBe(0);
    expect(html).toContain('aria-label="+1 more, show the list"');
    expect(html).toContain('>+1<');
    // The tile is one 48 px target at the right of the grid; the second lane stops 8 px short of it.
    const tile = block(html, '+1 more');
    expect(tile).toContain('width:3rem');
    expect(tile).toContain('right-0');
    expect(block(html, 'B')).toContain('width:calc(50% - 4px - 3rem - 8px)');
    expect(block(html, 'A')).toContain('width:calc(50% - 4px)');
  });

  it('draw the "+N" short of its box too, so it is 2 px from a block that follows it', () => {
    const html = grid(plan([event('A', OCT1, '16:00', '17:00'), event('B', OCT1, '16:00', '17:00'), event('C', OCT1, '16:00', '17:00')]));
    const tile = inner(html, '+1 more');
    expect(tile).toContain('height:max(3rem, 3rem)');
    expect(tile).toMatch(/<span[^>]*class="[^"]*\binset-x-0 top-0 bottom-0\.5\b[^"]*"[^>]*>/);
    expect(tile).toMatch(/class="[^"]*\bpb-0\.5\b/);
  });

  it('are named by what is drawn on them, so a name spoken from the screen finds them: "+2 more, show the list"', () => {
    const four = grid(plan([event('A', OCT1, '16:00', '17:00'), event('B', OCT1, '16:00', '17:00'), event('C', OCT1, '16:00', '17:00'), event('D', OCT1, '16:00', '17:00')]));
    expect(four).toContain('aria-label="+2 more, show the list"');
    expect(four).toContain('>+2<');
    const twelve = grid(plan('ABCDEFGHIJKL'.split('').map((title) => event(title, OCT1, '16:00', '17:00'))));
    expect(twelve).toContain('aria-label="+10 more, show the list"');
    expect(twelve).toContain('>+10<');
    // Whatever the count, the name starts with the words on the tile.
    for (const html of [four, twelve]) {
      const drawn = />(\+\d+)</.exec(html)?.[1];
      expect(/aria-label="(\+\d+ more[^"]*)"/.exec(html)?.[1]?.startsWith(drawn ?? 'nothing drawn')).toBe(true);
    }
  });

  it('are reached by Tab right after the blocks of their own cluster, not after every block of the day', () => {
    const html = grid(
      plan([
        // A cluster of three: Alpha and Bravo are drawn, Charlie is the "+1".
        event('Alpha', OCT1, '16:00', '17:00'),
        event('Bravo', OCT1, '16:00', '17:00'),
        event('Charlie', OCT1, '16:00', '17:00'),
        // A block of its own between the clusters.
        event('Dinner', OCT1, '18:30', '19:30'),
        // A cluster of four: Whiskey and Xray are drawn, the other two are the "+2".
        event('Xray', OCT1, '20:00', '21:00'),
        event('Yankee', OCT1, '20:00', '21:00'),
        event('Zulu', OCT1, '20:00', '21:00'),
        event('Whiskey', OCT1, '20:00', '21:00'),
      ]),
    );
    const at = (name: string) => html.indexOf(`aria-label="${name}`);
    const order = ['Alpha', 'Bravo', '+1 more', 'Dinner', 'Whiskey', 'Xray', '+2 more'].map(at);
    // Every name is there, and in this order: the tile of a cluster comes after the last block of that cluster and before the next.
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

describe('the rows above and below the grid', () => {
  const row = (props: Partial<Parameters<typeof PillRow>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(PillRow, { label: 'Later', name: 'Later', of: 'later events', control: says(), pills: [], day: dayOf(OCT1), people: FAMILY, empty: 'Nothing later today', onOpen: () => undefined, ...props }),
    );

  it('are one pill tall (52 px) when empty, when full and when they scroll, at the start and at the end', () => {
    const full = plan([event('Standup', OCT1, '09:00', '09:30', ['p-cory']), event('Review', OCT1, '13:00', '14:00', ['p-cory'])]).above;
    expect(full).toHaveLength(2);
    for (const html of [row(), row({ pills: full }), row({ pills: full, control: says(true) }), row({ pills: full, control: says(true, true) })]) {
      expect(html).toContain('role="group"');
      expect(html).toMatch(/class="flex h-13 flex-none gap-2"/);
    }
  });

  describe('when they hold more than fits', () => {
    const above = plan([event('Standup', OCT1, '09:00', '09:30', ['p-cory']), event('Design review', OCT1, '13:00', '14:00', ['p-cory'])]).above;
    const earlier = (control: OverflowControl, day = OCT1) =>
      row({ label: 'Earlier', name: 'All day and earlier', of: 'earlier events', pills: above, control, day: dayOf(day), empty: day === OCT1 ? 'Nothing earlier today' : 'Nothing earlier' });
    const later = (control: OverflowControl, day = OCT1) => row({ of: 'later events', pills: above, control, day: dayOf(day) });
    // The button the row's scrolling box is given: not a pill, whose names begin with their titles.
    const button = (html: string) => /<button[^>]*aria-label="(?:More|Back)[^"]*"[^>]*>/.exec(html)?.[0] ?? '';

    it('say so with "More" beside the row, after its pills, named for the row', () => {
      for (const [html, name] of [
        [earlier(says(true)), 'More earlier events'],
        [later(says(true)), 'More later events'],
      ] as const) {
        expect(html, name).toContain(`aria-label="${name}"`);
        // After the box that scrolls, and inside the group: it is beside the row, in the row's own gap.
        expect(html.indexOf('overflow-x-auto'), name).toBeLessThan(html.indexOf(`aria-label="${name}"`));
        expect(html.startsWith('<div role="group"'), name).toBe(true);
        expect(html.endsWith('</button></div>'), name).toBe(true);
      }
    });

    it('say how to get back at the end of the row, in the same words for what moves', () => {
      expect(earlier(says(true, true))).toContain('aria-label="Back to the first earlier events"');
      expect(later(says(true, true))).toContain('aria-label="Back to the first later events"');
      expect(earlier(says(true, true))).not.toContain('aria-label="More earlier events"');
    });

    it('name the same on a day that is not today: the rows\' own words drop "today", the buttons never had it', () => {
      for (const day of [OCT1, OCT2]) {
        expect(earlier(says(true), day)).toContain('aria-label="More earlier events"');
        expect(later(says(true), day)).toContain('aria-label="More later events"');
        expect(earlier(says(true, true), day)).toContain('aria-label="Back to the first earlier events"');
        expect(button(later(says(true), day))).not.toMatch(/today/);
      }
    });

    it('draw no button for a row that holds all it has, empty or full', () => {
      for (const html of [row(), earlier(says()), later(says())]) {
        expect(html).not.toMatch(/aria-label="(More|Back)/);
        expect(html).not.toContain('lucide-chevron');
      }
    });

    it('draw a button as tall as the row, 52 px, so the row does not grow, and the same one beside each row', () => {
      const one = button(earlier(says(true)));
      const other = button(later(says(true)));
      for (const tag of [one, other]) {
        expect(tag).toMatch(/\bh-13\b/);
        expect(tag).not.toMatch(/\bh-14\b/);
        // On the row's own card it is told apart by its fill, as every secondary button on a card is.
        expect(tag).toMatch(/\bbg-secondary\b/);
        expect(tag).not.toMatch(/\bbg-card\b/);
      }
      expect(one.replace(/aria-label="[^"]*"/, '')).toBe(other.replace(/aria-label="[^"]*"/, ''));
    });
  });

  it('say so when empty, and say nothing before the day has been read', () => {
    expect(row()).toContain('Nothing later today');
    expect(row({ empty: '' })).not.toContain('Nothing');
  });

  it('hold pills 220 px wide, one line of title, side by side and scrolling sideways', () => {
    const above = plan([event('Standup', OCT1, '09:00', '09:30', ['p-cory']), event('Design review', OCT1, '13:00', '14:00', ['p-cory'])]).above;
    const html = row({ label: 'Earlier', name: 'All day and earlier', pills: above });
    expect(html).toContain('aria-label="All day and earlier"');
    expect(html).toContain('>Earlier<');
    expect(count(html, 'w-[220px] flex-none')).toBe(2);
    expect(count(html, 'line-clamp-1')).toBe(2);
    expect(html).not.toContain('line-clamp-2');
    expect(html).toContain('overflow-x-auto');
    // The pills are the schedule's: named by title, who, day and time.
    expect(html).toContain('aria-label="Standup, Cory, Thursday, October 1, 9:00 AM"');
  });
});

describe('the list of a cluster', () => {
  it('has every event of the cluster, in order, each a pill that opens its details', () => {
    const p = plan([event('A', OCT1, '16:00', '17:00', ['p-ava']), event('B', OCT1, '16:00', '17:00', ['p-sam']), event('C', OCT1, '16:00', '17:00')]);
    const html = renderToStaticMarkup(createElement(ClusterList, { day: dayOf(OCT1), pills: p.folds[0]!.pills, profiles: FAMILY, onOpen: () => undefined, onClose: () => undefined }));
    expect(html).toContain('3 events around this time');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="cluster-list-title"');
    expect(html).toContain('aria-label="Close"');
    expect([...html.matchAll(/aria-label="([ABC]), /g)].map((found) => found[1])).toEqual(['A', 'B', 'C']);
    expect(count(html, 'data-pill')).toBe(3);
  });

  it('holds all twelve events of a crowded cluster in the one box that scrolls, under a title row that stays in view', () => {
    const p = plan('ABCDEFGHIJKL'.split('').map((title) => event(title, OCT1, '16:00', '17:00')));
    const html = renderToStaticMarkup(createElement(ClusterList, { day: dayOf(OCT1), pills: p.folds[0]!.pills, profiles: FAMILY, onOpen: () => undefined, onClose: () => undefined }));
    const [box] = scrollers(html);
    expect(scrollers(html)).toHaveLength(1);
    expect(count(box!, 'data-pill')).toBe(12);
    expect(count(html, 'data-pill')).toBe(12);
    // The title and Close are not in what scrolls; they are above it.
    expect(box).not.toContain('12 events around this time');
    expect(box).not.toContain('aria-label="Close"');
    expect(html.indexOf('12 events around this time')).toBeLessThan(html.indexOf(box!));
    expect(html.indexOf('aria-label="Close"')).toBeLessThan(html.indexOf(box!));
  });
});
