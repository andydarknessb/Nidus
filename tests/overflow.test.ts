import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FOOT_SCROLL_PADDING, OverflowButton } from '../src/components/OverflowButton';
import { overflowState, overflowWords, PAGE_STEP, type Axis, type Scroll } from '../src/lib/overflow';
import type { OverflowControl } from '../src/lib/use-overflow';

// Where the Wall scrolls it says so, with a button (docs/look.md, The parts). A tablet in a kiosk browser draws no scrollbars,
// so a fifth person's column, a fourth list and the tiles past the fold would otherwise be hidden with no sign. What the
// button does is decided here from four measurements and so is tested without a screen: whether the box overflows, whether
// it is at its end, and where one press takes it. The words and the markup are asserted below; where a screen puts the
// button, and that it can be tapped, is looked at in the browser.

// A box as the browser measures it: what its contents need (scrollWidth), what it shows (clientWidth), how far it is scrolled
// (scrollLeft) and what the button holds back while it is shown. A row and a column are one rule on one axis, so these are rows.
const box = (scrollSize: number, more: Partial<Scroll> = {}): Scroll => ({ scrollSize, clientSize: 1000, scrollOffset: 0, buttonSize: 0, ...more });

describe('whether a box overflows', () => {
  it('does not when what it holds fits, or is exactly what it shows', () => {
    for (const size of [0, 1, 500, 999, 1000]) expect(overflowState(box(size)).overflowing, `${size} in 1000`).toBe(false);
  });

  it('does not for the pixel that rounding adds (the browser rounds what is 0.4 px too wide up to 1 px)', () => {
    expect(overflowState(box(1001)).overflowing).toBe(false);
    expect(overflowState(box(1002)).overflowing).toBe(true);
  });

  it('does when it holds more than it shows', () => {
    expect(overflowState(box(1200)).overflowing).toBe(true);
    expect(overflowState(box(5000)).overflowing).toBe(true);
  });

  it('is nothing at all for a box with no size, and not NaN', () => {
    expect(overflowState({ scrollSize: 0, clientSize: 0, scrollOffset: 0, buttonSize: 0 })).toEqual({ overflowing: false, atEnd: true, next: 0 });
  });

  describe('with the button beside the box, which takes room from it while it is shown', () => {
    // The row has ROOM without the button and ROOM less the button (and its 8 px gap) with it: what the browser reports as the
    // row's width is the second while the button is shown. The button is therefore held to the room the row has without it.
    const ROOM = 1000;
    const BUTTON = 128;
    const beside = (content: number, shown: boolean): Scroll => ({ scrollSize: content, clientSize: shown ? ROOM - BUTTON : ROOM, scrollOffset: 0, buttonSize: shown ? BUTTON : 0 });

    it('asks for the button only for what does not fit in the room the row has without it', () => {
      expect(overflowState(beside(990, true)).overflowing).toBe(false);
      expect(overflowState(beside(1001, true)).overflowing).toBe(false);
      expect(overflowState(beside(1002, true)).overflowing).toBe(true);
      expect(overflowState(beside(1500, true)).overflowing).toBe(true);
    });

    it('never comes and goes: drawing the button never decides whether it is needed', () => {
      for (let content = 0; content <= 2400; content += 1) {
        expect(overflowState(beside(content, true)).overflowing, `${content} with the button`).toBe(overflowState(beside(content, false)).overflowing);
      }
    });
  });

  describe('with the button over the end of the box, which the box pads by what it covers while it is shown', () => {
    // A column's foot is the last child of its list, so while it is shown the list holds its own height more.
    const BOX = 400;
    const FOOT = 64;
    const over = (content: number, shown: boolean): Scroll => ({ scrollSize: content + (shown ? FOOT : 0), clientSize: BOX, scrollOffset: 0, buttonSize: shown ? FOOT : 0, over: true });

    it('asks for the button only for content that does not fit in the box', () => {
      expect(overflowState(over(399, true)).overflowing).toBe(false);
      expect(overflowState(over(401, true)).overflowing).toBe(false);
      expect(overflowState(over(402, true)).overflowing).toBe(true);
    });

    it('never comes and goes: the foot it adds to the list never decides whether it is needed', () => {
      for (let content = 0; content <= 1200; content += 1) {
        expect(overflowState(over(content, true)).overflowing, `${content} with the foot`).toBe(overflowState(over(content, false)).overflowing);
      }
    });
  });
});

describe('whether a box is at its end', () => {
  it('is not at the start of a box that overflows', () => {
    expect(overflowState(box(1500)).atEnd).toBe(false);
  });

  it('is when it is scrolled as far as it goes', () => {
    expect(overflowState(box(1500, { scrollOffset: 500 })).atEnd).toBe(true);
    expect(overflowState(box(1500, { scrollOffset: 499 })).atEnd).toBe(true);
    expect(overflowState(box(1500, { scrollOffset: 498 })).atEnd).toBe(false);
  });

  it('is at the end of a row whose button takes room from it, by the room it has now', () => {
    // 1500 of content in a row that shows 872 while the button is there: the row scrolls 628 px.
    const row = { scrollSize: 1500, clientSize: 872, buttonSize: 128 };
    expect(overflowState({ ...row, scrollOffset: 627 }).atEnd).toBe(true);
    expect(overflowState({ ...row, scrollOffset: 626 }).atEnd).toBe(false);
  });

  it('is never at the end at the start of a box that needs its button, whatever the button is', () => {
    for (const buttonSize of [0, 64, 128]) {
      for (let size = 1002 + buttonSize; size <= 3000; size += 7) {
        const state = overflowState({ scrollSize: size, clientSize: 1000, scrollOffset: 0, buttonSize });
        expect(state.overflowing, `${size} with ${buttonSize}`).toBe(true);
        expect(state.atEnd, `${size} with ${buttonSize}`).toBe(false);
      }
    }
  });
});

describe('where one press goes', () => {
  it('is most of a page on: four fifths of what the box shows', () => {
    expect(PAGE_STEP).toBe(0.8);
    expect(overflowState(box(3000)).next).toBe(800);
    expect(overflowState(box(3000, { scrollOffset: 800 })).next).toBe(1600);
  });

  it('stops at the end and never goes past it', () => {
    // 2000 of content in 1000 scrolls 1000 px: from 700 a page would reach 1500.
    expect(overflowState(box(2000, { scrollOffset: 700 })).next).toBe(1000);
    expect(overflowState(box(1500, { scrollOffset: 0 })).next).toBe(500);
  });

  it('goes back to the start from the end', () => {
    expect(overflowState(box(1500, { scrollOffset: 500 })).next).toBe(0);
    expect(overflowState(box(1500, { scrollOffset: 500, buttonSize: 64, over: true })).next).toBe(0);
  });

  it('goes by most of the part of a column that the button leaves clear, so nothing slips under the button', () => {
    // A 400 px list with a 64 px foot over its end shows 336 clear of it: a press moves it on by four fifths of that.
    const column = { scrollSize: 1064, clientSize: 400, buttonSize: 64, over: true };
    expect(overflowState({ ...column, scrollOffset: 0 }).next).toBeCloseTo(0.8 * 336, 6);
    for (let offset = 0; offset < 600; offset += 13) {
      const state = overflowState({ ...column, scrollOffset: offset });
      if (!state.atEnd) expect(state.next - offset, `from ${offset}`).toBeLessThanOrEqual(400 - 64);
    }
  });

  it('goes by a page of the room that is left to a row whose button takes room from it, which is what the row shows', () => {
    // The row shows 872 with the button beside it: the button is not over any of it, so the page is the 872.
    expect(overflowState({ scrollSize: 3000, clientSize: 872, scrollOffset: 0, buttonSize: 128 }).next).toBeCloseTo(0.8 * 872, 6);
  });

  it('moves on every press until the end, which a press then leaves for the start', () => {
    function presses(measured: Omit<Scroll, 'scrollOffset'>) {
      let offset = 0;
      const visited = [0];
      for (let press = 0; press <= 200; press += 1) {
        const state = overflowState({ ...measured, scrollOffset: offset });
        if (state.atEnd) return { visited, back: state.next };
        expect(state.next, `press ${press + 1} from ${offset}`).toBeGreaterThan(offset);
        offset = state.next;
        visited.push(offset);
      }
      throw new Error('a press never reached the end');
    }
    // Three screens of content: 800, 1600, then the end at 2000, and Back.
    expect(presses({ scrollSize: 3000, clientSize: 1000, buttonSize: 0 })).toEqual({ visited: [0, 800, 1600, 2000], back: 0 });
    // Just over one screen: one press reaches the end.
    expect(presses({ scrollSize: 1100, clientSize: 1000, buttonSize: 0 })).toEqual({ visited: [0, 100], back: 0 });
    // Eight columns of 272 px with 12 px between them in a 1136 px row, as the chart's, and fourteen tiles in a column.
    const chart = presses({ scrollSize: 8 * 272 + 7 * 12, clientSize: 1136, buttonSize: 0 });
    expect(chart.visited.at(-1)).toBe(8 * 272 + 7 * 12 - 1136);
    expect(chart.back).toBe(0);
    const column = presses({ scrollSize: 14 * 90 + 64, clientSize: 440, buttonSize: 64, over: true });
    expect(column.visited.at(-1)).toBe(14 * 90 + 64 - 440);
  });

  it('is always forward of where it is until the end, and never past it, for any box and any place in it', () => {
    for (const buttonSize of [0, 64, 136]) {
      for (const over of [false, true]) {
        for (let size = 1002 + buttonSize; size <= 4000; size += 97) {
          for (let offset = 0; offset <= size - 1000; offset += 41) {
            const state = overflowState({ scrollSize: size, clientSize: 1000, scrollOffset: offset, buttonSize, over });
            const where = `${size} at ${offset} with ${buttonSize}${over ? ' over' : ''}`;
            if (state.atEnd) expect(state.next, where).toBe(0);
            else {
              expect(state.next, where).toBeGreaterThan(offset);
              expect(state.next, where).toBeLessThanOrEqual(size - 1000);
            }
          }
        }
      }
    }
  });

  it('still moves on in a box too short for its button, a pixel at a time at least, rather than stand still', () => {
    const state = overflowState({ scrollSize: 300, clientSize: 40, scrollOffset: 0, buttonSize: 64, over: true });
    expect(state.next).toBeGreaterThan(0);
  });
});

describe('the words', () => {
  it('say what moves, for a row', () => {
    expect(overflowWords('x', 'people')).toEqual({
      more: { text: 'More people', name: 'More people' },
      back: { text: 'Back', name: 'Back to the first people' },
    });
    expect(overflowWords('x', 'lists')).toEqual({
      more: { text: 'More lists', name: 'More lists' },
      back: { text: 'Back', name: 'Back to the first lists' },
    });
  });

  it('say what moves, for a column', () => {
    expect(overflowWords('y', "Ava's routines")).toEqual({
      more: { text: 'More', name: "More of Ava's routines" },
      back: { text: 'Back', name: "Back to the top of Ava's routines" },
    });
    expect(overflowWords('y', 'Groceries')).toEqual({
      more: { text: 'More', name: 'More of Groceries' },
      back: { text: 'Back', name: 'Back to the top of Groceries' },
    });
  });

  it('have every visible word in the accessible name, so a name spoken from the screen finds the button', () => {
    for (const [axis, of] of [['x', 'people'], ['x', 'lists'], ['y', "Ava's routines"], ['y', 'Groceries']] as const) {
      const { more, back } = overflowWords(axis, of);
      expect(more.name, `${axis} ${of}`).toContain(more.text);
      expect(back.name, `${axis} ${of}`).toContain(back.text);
    }
  });

  it('use no dash of any length', () => {
    for (const axis of ['x', 'y'] as const) {
      const { more, back } = overflowWords(axis, 'people');
      expect([more.text, more.name, back.text, back.name].join(' ')).not.toMatch(/[‒-―-]/);
    }
  });
});

describe('the button', () => {
  // The control a hook would hand over, in the state a test needs: markup is made without the browser's measuring.
  const control = (axis: Axis, atEnd: boolean, overflowing = true): OverflowControl => ({ axis, overflowing, atEnd, scroller: () => undefined, piece: () => undefined, step: () => undefined });
  const render = (axis: Axis, atEnd: boolean, of: string, surface?: 'card' | 'person') => renderToStaticMarkup(createElement(OverflowButton, { control: control(axis, atEnd), of, ...(surface ? { surface } : {}) }));
  // The label a person sees: the one that is not hidden. (The other is drawn invisible in the same place, so the button is as wide
  // as the wider of the two and never changes size.) Each label is one span in the button's one grid cell.
  const labels = (html: string) => [...html.matchAll(/<span([^>]*col-start-1[^>]*)>(.*?)<\/span>/g)].map(([, attributes, inner]) => ({ hidden: attributes!.includes('aria-hidden'), inner: inner! }));
  const visible = (html: string) => labels(html).filter((label) => !label.hidden).map((label) => label.inner).join('');
  const hidden = (html: string) => labels(html).filter((label) => label.hidden).map((label) => label.inner).join('');

  it('is nothing at all for a box that does not overflow', () => {
    expect(renderToStaticMarkup(createElement(OverflowButton, { control: control('x', false, false), of: 'people' }))).toBe('');
    expect(renderToStaticMarkup(createElement(OverflowButton, { control: control('y', false, false), of: 'Groceries' }))).toBe('');
  });

  it('reads "More people" with a chevron pointing on, in a row, and "Back" with one pointing back at the end', () => {
    const more = render('x', false, 'people');
    expect(more).toContain('aria-label="More people"');
    expect(visible(more)).toContain('More people');
    expect(visible(more)).toContain('lucide-chevron-right');
    const back = render('x', true, 'people');
    expect(back).toContain('aria-label="Back to the first people"');
    expect(visible(back)).toContain('Back');
    expect(visible(back)).toContain('lucide-chevron-left');
    expect(visible(back)).not.toContain('More people');
  });

  it('reads "More" with a chevron down, in a column, and "Back" with one up at the end', () => {
    const more = render('y', false, "Ava's routines", 'person');
    expect(more).toContain('aria-label="More of Ava&#x27;s routines"');
    expect(visible(more)).toContain('More');
    expect(visible(more)).toContain('lucide-chevron-down');
    const back = render('y', true, "Ava's routines", 'person');
    expect(back).toContain('aria-label="Back to the top of Ava&#x27;s routines"');
    expect(visible(back)).toContain('Back');
    expect(visible(back)).toContain('lucide-chevron-up');
  });

  it('draws both labels in one place, the other invisible and out of the accessibility tree, so its width is the wider of the two', () => {
    for (const atEnd of [false, true]) {
      const html = render('x', atEnd, 'people');
      expect(html).toContain('More people');
      expect(html).toContain('Back');
      expect(html.split('invisible').length - 1, `atEnd ${atEnd}`).toBe(1);
      expect(hidden(html)).toContain(atEnd ? 'More people' : 'Back');
    }
  });

  it('is never switched off: at the end it takes the keyboard back to the start, so it is neither disabled nor aria-disabled', () => {
    for (const axis of ['x', 'y'] as const) {
      for (const atEnd of [false, true]) {
        const html = render(axis, atEnd, 'people');
        // (The button's own classes say `disabled:` for a button that is switched off; this one never is.)
        expect(html, `${axis} atEnd ${atEnd}`).not.toMatch(/ disabled[ =>"]/);
        expect(html, `${axis} atEnd ${atEnd}`).not.toContain('aria-disabled');
      }
    }
  });

  it('is a secondary button, never the primary one, on the colour it sits on, and at least 48 px tall', () => {
    const row = render('x', false, 'lists');
    const onCard = render('y', false, 'Groceries', 'card');
    const onPerson = render('y', false, "Ava's routines", 'person');
    // A row's button is a card on the page, as the strip's was; a foot is a card on a person's column and a row's colour on a card.
    expect(row).toContain('bg-card');
    expect(onPerson).toContain('bg-card');
    expect(onCard).toContain('bg-secondary');
    for (const html of [row, onCard, onPerson]) expect(html).not.toContain('bg-primary');
    expect(row).toMatch(/\bh-1[34]\b/);
    expect(onCard).toMatch(/\bh-12\b/);
    expect(onPerson).toMatch(/\bh-12\b/);
  });

  // The opening tags of a column's foot (the box over the list's end) and of its button.
  const tags = (html: string) => ({ foot: /^<div[^>]*>/.exec(html)?.[0] ?? '', button: /<button[^>]*>/.exec(html)?.[0] ?? '' });

  it('is, in a column, a foot over a fade in the colour it sits on, that taps pass through but for the button itself', () => {
    const card = tags(render('y', false, 'Groceries', 'card'));
    const person = tags(render('y', false, "Ava's routines", 'person'));
    expect(card.foot).toContain('from-card');
    expect(person.foot).toContain('from-person-soft');
    for (const { foot, button } of [card, person]) {
      expect(foot).toContain('sticky');
      expect(foot, 'taps go through the fade to the tiles under it').toMatch(/\bpointer-events-none\b/);
      expect(button, 'and only the button takes them').toMatch(/\bpointer-events-auto\b/);
    }
  });

  it('is as tall, as a foot, as the end padding it asks of its list, so the last tile can always be scrolled clear of it', () => {
    // The foot is h-16 (64 px): the button's 48 and a 16 px fade above it. Its list scrolls to 64 px clear of its end (scroll-pb-16),
    // and the foot, the last thing in the list, is what pads its end.
    expect(tags(render('y', false, 'Groceries')).foot).toMatch(/\bh-16\b/);
    expect(FOOT_SCROLL_PADDING).toBe('scroll-pb-16');
  });

  it('is a row\'s button as it was in the people strip: a button of its own, with no foot or fade', () => {
    const html = render('x', false, 'people');
    expect(html).not.toContain('sticky');
    expect(html).not.toContain('from-');
    expect(html.startsWith('<button')).toBe(true);
  });
});
