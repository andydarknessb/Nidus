import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DayChips, PhoneCard, Pager, Segmented, SideScroll } from '../src/phone/parts';

// The phone's shared parts rendered to markup: their names, their states and the sizes the look gives them. Colours are tokens only
// (no hard-coded colour, no branch on the mode), which the class names show. How they sit in a 390 px column is looked at in a browser.

const noop = () => undefined;
const WEEK = ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'];

// Every button: its attributes and its words.
function buttons(html: string): { tag: string; words: string }[] {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((match) => ({ tag: match[1]!, words: match[2]!.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() }));
}
const nameOf = (tag: string) => /aria-label="([^"]*)"/.exec(tag)?.[1];
const classesOf = (tag: string) => (/class="([^"]*)"/.exec(tag)?.[1] ?? '').replaceAll('&amp;', '&').replaceAll('&gt;', '>').split(' ');
const pressedOf = (tag: string) => /aria-pressed="(true|false)"/.exec(tag)?.[1];

describe('DayChips', () => {
  const chips = (picked: string, today = '2026-10-01') => renderToStaticMarkup(createElement(DayChips, { label: 'Days of this week', dates: WEEK, today, picked, onPick: noop }));

  it('is a named group of seven buttons, each named by its weekday and date, and "today" for today', () => {
    const html = chips('2026-10-01');
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Days of this week"');
    expect(buttons(html).map((button) => nameOf(button.tag))).toEqual([
      'Sunday 27',
      'Monday 28',
      'Tuesday 29',
      'Wednesday 30',
      'Thursday 1, today',
      'Friday 2',
      'Saturday 3',
    ]);
  });

  it('draws the weekday over the date, and for today the word "Today" over the date in a 34 px primary disc', () => {
    const html = chips('2026-10-02');
    const all = buttons(html);
    expect(all[5]!.words).toBe('Fri 2');
    expect(all[4]!.words).toBe('Today 1');
    expect(all[4]!.tag).toContain('aria-current="date"');
    expect(html).toContain('size-[34px]');
    expect(html).toContain('bg-primary');
    // Only today's chip says it is the date.
    expect(html.split('aria-current="date"').length - 1).toBe(1);
  });

  it('presses the picked chip alone, and a week that does not hold today has no chip that is today', () => {
    const states = buttons(chips('2026-09-30')).map((button) => pressedOf(button.tag));
    expect(states).toEqual(['false', 'false', 'false', 'true', 'false', 'false', 'false']);
    const later = chips('2026-09-27', '2026-10-20');
    expect(later).not.toContain('aria-current="date"');
    expect(later).not.toContain('today');
  });

  it('shares the row between the seven, each at least 48 wide and 64 tall with a 14 px radius, and the targets touch', () => {
    const html = chips('2026-10-01');
    const first = classesOf(buttons(html)[0]!.tag);
    expect(first).toEqual(expect.arrayContaining(['h-16', 'min-w-12', 'flex-1', 'rounded-[14px]']));
    const row = classesOf(html.slice(0, html.indexOf('>') + 1));
    expect(row).toContain('gap-0');
    expect(row.some((name) => /^gap-[1-9]/.test(name))).toBe(false);
  });

  it('bleeds over the padding of its card and scrolls sideways when the seven do not fit', () => {
    const row = classesOf(chips('2026-10-01').slice(0, chips('2026-10-01').indexOf('>') + 1));
    expect(row).toEqual(expect.arrayContaining(['-mx-3', 'overflow-x-auto', '[scrollbar-width:none]']));
  });

  it('draws the Selected look 2 px inside the button, on an inner span, and not on the button itself', () => {
    const html = chips('2026-10-02');
    const button = classesOf(buttons(html)[0]!.tag);
    expect(button).toContain('p-0.5');
    // The focus ring is drawn inside the button, so the row that scrolls does not clip it.
    expect(button).toContain('focus-visible:-outline-offset-2');
    expect(button).not.toContain('selected:bg-accent');
    expect(button).not.toContain('selected:ring-2');
    expect(html).toContain('group-aria-pressed:bg-accent');
    expect(html).toContain('group-aria-pressed:ring-2');
    expect(html).toContain('group-aria-pressed:ring-foreground');
  });
});

describe('DayChips, days that cannot be picked', () => {
  const chips = (canPick?: (date: string) => boolean) =>
    renderToStaticMarkup(createElement(DayChips, { label: 'Days of this week', dates: WEEK, today: '2026-10-01', picked: '2026-10-01', onPick: noop, ...(canPick ? { canPick } : {}) }));

  it('draws a day that cannot be picked as a hatched cell that says so, and not as a button', () => {
    const html = chips((date) => date >= '2026-09-30');
    expect(buttons(html).map((button) => nameOf(button.tag))).toEqual(['Wednesday 30', 'Thursday 1, today', 'Friday 2', 'Saturday 3']);
    expect(html.split('repeating-linear-gradient').length - 1).toBe(3);
    expect(html).toContain('Sunday 27, Beyond the calendar&#x27;s range');
    expect(html).toContain('Tuesday 29, Beyond the calendar&#x27;s range');
    // Still seven things in the row, each sharing the width.
    expect(html.match(/data-day="/g)).toHaveLength(7);
  });

  it('is the same markup when every day can be picked, or when nothing is passed', () => {
    expect(chips(() => true)).toBe(chips());
    expect(chips()).not.toContain('repeating-linear-gradient');
  });
});

describe('Segmented', () => {
  type View = 'day' | 'week' | 'month';
  const OPTIONS: { value: View; label: string }[] = [
    { value: 'day', label: 'Day' },
    { value: 'week', label: 'Week' },
    { value: 'month', label: 'Month' },
  ];
  const control = (value: View) => renderToStaticMarkup(createElement(Segmented<View>, { label: 'Calendar view', options: OPTIONS, value, onChange: noop }));

  it('is a named group of buttons, the choice pressed', () => {
    const html = control('week');
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Calendar view"');
    expect(buttons(html).map((button) => [button.words, pressedOf(button.tag)])).toEqual([
      ['Day', 'false'],
      ['Week', 'true'],
      ['Month', 'false'],
    ]);
  });

  it('is a 52 tall muted track, 2 px of padding round buttons 48 tall that touch', () => {
    const html = control('day');
    const track = classesOf(html.slice(0, html.indexOf('>') + 1));
    expect(track).toEqual(expect.arrayContaining(['h-13', 'bg-muted', 'p-0.5']));
    expect(track.some((name) => /^gap-/.test(name))).toBe(false);
    expect(classesOf(buttons(html)[0]!.tag)).toEqual(expect.arrayContaining(['h-12', 'flex-auto', 'p-0.5', 'focus-visible:-outline-offset-2']));
  });

  it('sizes each button from its word, at 15 px on one line from 360 px, so "Whole day" and "Afternoon" are never broken or cut there', () => {
    const html = control('day');
    for (const button of buttons(html)) {
      const classes = classesOf(button.tag);
      expect(classes).not.toContain('flex-1');
      expect(classes).not.toContain('whitespace-normal');
    }
    const word = classesOf(/<span class="([^"]*items-center[^"]*)"/.exec(html)![0]);
    expect(word).toEqual(expect.arrayContaining(['text-[15px]', 'leading-5', 'whitespace-nowrap']));
  });

  it('lets the buttons shrink and the words wrap below 360 px, in 18 px lines that keep two lines inside the 48 px button', () => {
    const html = control('day');
    for (const button of buttons(html)) {
      const classes = classesOf(button.tag);
      expect(classes).toEqual(expect.arrayContaining(['h-12', 'min-w-0', 'flex-auto']));
      // twMerge drops the Button's own shrink-0 for flex-auto, which shrinks.
      expect(classes).not.toContain('shrink-0');
    }
    const word = classesOf(/<span class="([^"]*items-center[^"]*)"/.exec(html)![0]);
    expect(word).toEqual(expect.arrayContaining(['max-[359px]:whitespace-normal', 'max-[359px]:leading-[18px]']));
  });

  it('draws the choice in the Selected look 2 px inside its button, not on the button', () => {
    const html = control('week');
    const button = classesOf(buttons(html)[1]!.tag);
    expect(button).not.toContain('selected:bg-accent');
    expect(button).not.toContain('selected:ring-2');
    expect(html).toContain('group-aria-pressed:bg-accent');
    expect(html).toContain('group-aria-pressed:ring-2');
  });
});

describe('Pager', () => {
  const pager = (previous: (() => void) | null, next: (() => void) | null) =>
    renderToStaticMarkup(createElement(Pager, { words: 'Sep 27 to Oct 3, 2026', previousLabel: 'Previous week', nextLabel: 'Next week', onPrevious: previous, onNext: next }));

  it('names its two round buttons for what they move by, with the words between them as a heading', () => {
    const html = pager(noop, noop);
    const [previous, next] = buttons(html);
    expect(nameOf(previous!.tag)).toBe('Previous week');
    expect(nameOf(next!.tag)).toBe('Next week');
    expect(html).toMatch(/<h2[^>]*>Sep 27 to Oct 3, 2026<\/h2>/);
    expect(html.indexOf('Previous week')).toBeLessThan(html.indexOf('<h2'));
    expect(html.indexOf('<h2')).toBeLessThan(html.indexOf('Next week'));
  });

  it('draws the buttons 48 px round and the words in the display face at 22', () => {
    const html = pager(noop, noop);
    expect(classesOf(buttons(html)[0]!.tag)).toEqual(expect.arrayContaining(['size-12', 'rounded-full', 'bg-card']));
    expect(html).toContain('font-display text-[22px]');
  });

  it('switches off a button that has nowhere to go', () => {
    const [previous, next] = buttons(pager(null, noop));
    expect(previous!.tag).toContain(' disabled=""');
    expect(next!.tag).not.toContain(' disabled=""');
  });
});

describe('SideScroll', () => {
  const row = renderToStaticMarkup(createElement(SideScroll, { label: 'People', children: [createElement('button', { type: 'button', key: 'a' }, 'Ava'), createElement('button', { type: 'button', key: 'b' }, 'Ben')] }));
  const rowClasses = classesOf(row.slice(0, row.indexOf('>') + 1));

  it('is a named group that scrolls sideways in one line, without a scroll bar', () => {
    expect(row).toContain('role="group"');
    expect(row).toContain('aria-label="People"');
    expect(rowClasses).toEqual(expect.arrayContaining(['flex', 'overflow-x-auto', '[scrollbar-width:none]', '[&::-webkit-scrollbar]:hidden']));
    expect(rowClasses).not.toContain('flex-wrap');
    // Room above and below, so an item's focus ring is not cut by the scroller.
    expect(rowClasses).toContain('py-1');
  });

  it('keeps each item at its natural width and leaves them real buttons', () => {
    expect(rowClasses).toContain('[&>*]:shrink-0');
    expect(buttons(row).map((button) => button.words)).toEqual(['Ava', 'Ben']);
  });
});

describe('PhoneCard', () => {
  it('is a card 22 round with 12 inside and 8 between its children', () => {
    const html = renderToStaticMarkup(createElement(PhoneCard, { children: [createElement('p', { key: 'a' }, 'One'), createElement('p', { key: 'b' }, 'Two')] }));
    expect(classesOf(html.slice(0, html.indexOf('>') + 1))).toEqual(expect.arrayContaining(['flex', 'flex-col', 'gap-2', 'rounded-[22px]', 'bg-card', 'p-3']));
    expect(html).toContain('One');
  });

  it('is a named region when given a name, and a plain box when not', () => {
    expect(renderToStaticMarkup(createElement(PhoneCard, { label: 'Today', children: 'x' }))).toMatch(/^<section aria-label="Today"/);
    expect(renderToStaticMarkup(createElement(PhoneCard, { children: 'x' }))).toMatch(/^<div /);
  });
});

describe('the parts keep to the tokens', () => {
  it('hard-code no colour and branch on no mode', () => {
    const html = [
      renderToStaticMarkup(createElement(DayChips, { label: 'Days', dates: WEEK, today: '2026-10-01', picked: '2026-10-01', onPick: noop })),
      renderToStaticMarkup(createElement(Pager, { words: 'x', previousLabel: 'a', nextLabel: 'b', onPrevious: noop, onNext: noop })),
      renderToStaticMarkup(createElement(PhoneCard, { children: 'x' })),
    ].join('');
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|dark:/);
  });
});
