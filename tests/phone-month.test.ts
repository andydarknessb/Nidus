import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { monthWeeks, type Occurrence } from '../src/lib/calendar-occurrences';
import type { Profile } from '../src/lib/profiles';
import { MonthDay } from '../src/phone/PhoneMonth';

// A Month cell on the phone rendered to markup: its name (the full date and how many events), its marks and the sizes the look gives it.
// Who the dots are for is tested without a screen in phone-calendar.test.ts; how the grid sits in a 390 px column is looked at in a browser.

const noop = () => undefined;
const [WEEK] = monthWeeks('2026-10-01', 'America/New_York', '2026-10-02');
const dayOf = (date: string) => WEEK!.find((day) => day.date === date)!;
const profile = (id: string, name: string): Profile => ({ id, name, color: '#93c5fd', avatar_url: null, sort_order: 0 });
const AVA = profile('a', 'Ava');
const BEN = profile('b', 'Ben');

let count = 0;
const event = (profile_ids: string[]): Occurrence => ({
  source: 'synced',
  id: `e${++count}`,
  calendar_id: 'cal',
  calendar_name: 'Calendar',
  title: 'Piano',
  description: null,
  location: null,
  starts_at: '2026-10-02T14:00:00Z',
  ends_at: '2026-10-02T15:00:00Z',
  is_all_day: false,
  profile_id: profile_ids[0] ?? null,
  profile_ids,
});

function cell(date: string, props: Partial<Parameters<typeof MonthDay>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(MonthDay, { day: dayOf(date), inMonth: true, beyond: false, picked: false, occurrences: [], profiles: [AVA, BEN], pressed: [], onPick: noop, ...props }),
  );
}
const tagOf = (html: string) => html.slice(0, html.indexOf('>') + 1);
const classesOf = (html: string) => (/class="([^"]*)"/.exec(html)?.[1] ?? '').replaceAll('&amp;', '&').replaceAll('&gt;', '>').split(' ');

describe('a phone Month cell', () => {
  it('is a button named with the full date and how many events it has', () => {
    const four = cell('2026-10-02', { occurrences: [event([]), event(['a']), event(['b']), event(['a', 'b'])] });
    expect(tagOf(four)).toMatch(/^<button\b/);
    expect(tagOf(four)).toContain('aria-label="Friday, October 2, 4 events"');
    expect(tagOf(cell('2026-10-03', { occurrences: [event(['a'])] }))).toContain('aria-label="Saturday, October 3, 1 event"');
    expect(tagOf(cell('2026-10-01'))).toContain('aria-label="Thursday, October 1, no events"');
  });

  it('gives the date alone until its week has been read, so a free day is never claimed before it is known to be', () => {
    expect(tagOf(cell('2026-10-02', { occurrences: null }))).toContain('aria-label="Friday, October 2"');
    expect(/aria-label="([^"]*)"/.exec(tagOf(cell('2026-10-02', { occurrences: null })))![1]).not.toMatch(/event/);
  });

  it('marks today alone as the date, in a 30 px --primary disc', () => {
    const today = cell('2026-10-02');
    expect(tagOf(today)).toContain('aria-current="date"');
    expect(today).toContain('bg-primary');
    expect(today).toContain('size-[30px]');
    expect(tagOf(cell('2026-10-03'))).not.toContain('aria-current');
  });

  it('presses the picked day alone, and draws the Selected look 2 px inside the button', () => {
    expect(tagOf(cell('2026-10-02', { picked: true }))).toContain('aria-pressed="true"');
    expect(tagOf(cell('2026-10-03'))).toContain('aria-pressed="false"');
    const html = cell('2026-10-03', { picked: true });
    const button = classesOf(tagOf(html));
    expect(button).toContain('p-0.5');
    expect(button).not.toContain('selected:bg-accent');
    expect(html).toContain('group-aria-pressed:bg-accent');
    expect(html).toContain('group-aria-pressed:ring-2');
    expect(html).toContain('group-aria-pressed:ring-foreground');
  });

  it('is 58 tall and at least 48 wide, with the date in the display face at 18', () => {
    const html = cell('2026-10-03');
    expect(classesOf(tagOf(html))).toEqual(expect.arrayContaining(['h-[58px]', 'min-w-12']));
    expect(html).toContain('font-display text-lg');
  });

  it('dims the dates of the neighbouring months with the muted colour, never a lighter one', () => {
    const dateOf = (html: string) => /<span aria-hidden="true" class="([^"]*)">3<\/span>/.exec(html)![1]!.split(' ');
    expect(dateOf(cell('2026-10-03', { inMonth: false }))).toContain('text-muted-foreground');
    expect(dateOf(cell('2026-10-03', { inMonth: true }))).toContain('text-foreground');
  });

  it('draws a 7 px dot for each person and the Household, in --primary for the Household, hidden from a screen reader', () => {
    const html = cell('2026-10-02', { occurrences: [event([]), event(['a']), event(['b'])] });
    expect(html.match(/size-\[7px\]/g)).toHaveLength(3);
    expect(html).toContain('size-[7px] rounded-full bg-primary');
    expect(html.match(/bg-person-strong/g)).toHaveLength(2);
    expect(html).toMatch(/<span aria-hidden="true" class="flex h-\[7px\] gap-1">/);
  });

  it('draws at most three dots', () => {
    const many = [event([]), event(['a']), event(['b']), event(['c']), event(['d'])];
    const html = cell('2026-10-02', { occurrences: many, profiles: [AVA, BEN, profile('c', 'Cory'), profile('d', 'Dee')] });
    expect(html.match(/size-\[7px\]/g)).toHaveLength(3);
  });

  it('draws no dot for a day that has not been read, and none for a free one', () => {
    expect(cell('2026-10-02', { occurrences: null })).not.toContain('size-[7px] rounded-full');
    expect(cell('2026-10-02')).not.toContain('size-[7px] rounded-full');
  });

  it('draws only the dots the Profile filter lets through', () => {
    // An event for two of three people: with Ava pressed it is on the day for her, and Ben has no dot for it.
    const profiles = [AVA, BEN, profile('c', 'Cory')];
    const shared = [event(['a', 'b'])];
    expect(cell('2026-10-02', { occurrences: shared, profiles, pressed: ['a'] }).match(/bg-person-strong/g)).toHaveLength(1);
    expect(cell('2026-10-02', { occurrences: shared, profiles }).match(/bg-person-strong/g)).toHaveLength(2);
  });

  it('is no button beyond the range the calendar keeps, and says so', () => {
    const html = cell('2026-10-02', { beyond: true });
    expect(html).not.toContain('<button');
    expect(html).toContain("Beyond the calendar's range".replace("'", '&#x27;'));
  });
});
