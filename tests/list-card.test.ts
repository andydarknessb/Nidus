import { describe, expect, it } from 'vitest';
import { HOME_HOLD_MS, homeRows, pinnedFirst, rowsThatFit, type ListItem, type SharedList } from '../src/lib/shared-lists';

// Pure rules for a Shared List's card on the Wall: how many rows Home's card holds, which rows it draws, and which list comes
// first on the Lists screen. They run without the local stack.

// Home's card, from the drawing (v2/home.js): a row is 48 px and the gap between rows 8.
const ROW = 48;
const GAP = 8;
const fit = (count: number, room: number) => rowsThatFit({ count, room, row: ROW, gap: GAP });

describe('rowsThatFit', () => {
  it('shows nothing for a list with no rows, whatever the room', () => {
    expect(fit(0, 0)).toBe(0);
    expect(fit(0, 500)).toBe(0);
  });

  it('shows every row when they all fit', () => {
    // Three rows are 3 x 48 + 2 x 8 = 160 tall.
    expect(fit(3, 160)).toBe(3);
    expect(fit(3, 400)).toBe(3);
    expect(fit(1, 48)).toBe(1);
  });

  it('shows as many as fit when they do not all fit', () => {
    // Two rows are 104 tall, three 160, four 216.
    expect(fit(10, 104)).toBe(2);
    expect(fit(10, 159)).toBe(2);
    expect(fit(10, 160)).toBe(3);
    expect(fit(10, 215)).toBe(3);
    expect(fit(10, 216)).toBe(4);
    expect(fit(3, 159)).toBe(2);
  });

  it('shows no row when not even one fits, down to no room at all', () => {
    expect(fit(5, 47)).toBe(0);
    expect(fit(5, 0)).toBe(0);
    expect(fit(5, -20)).toBe(0);
  });

  it('is the card at three heights: two rows at 250 px, one at 200, and exactly two at 244 under a 336 px Up next', () => {
    // The card's own parts: 24 of padding, a 48 heading, a 52 add row and two 8 gaps. 250 px leaves 110, 200 leaves 60, and 244
    // (the 596 px of the right column at 1280 x 800, less Up next and a 16 gap) leaves 104.
    const room = (card: number) => card - 24 - 48 - 52 - 16;
    expect(fit(4, room(250))).toBe(2);
    expect(fit(4, room(200))).toBe(1);
    expect(fit(4, room(244))).toBe(2);
  });

  it('is never more than the rows there are, and never negative', () => {
    for (let count = 0; count <= 12; count += 1) {
      for (let room = -50; room <= 700; room += 1) {
        const shown = fit(count, room);
        expect(shown).toBeGreaterThanOrEqual(0);
        expect(shown).toBeLessThanOrEqual(count);
      }
    }
  });

  it('shows what fits, and no fewer than would: one row more would not have fitted', () => {
    for (let count = 1; count <= 12; count += 1) {
      for (let room = 0; room <= 700; room += 1) {
        const shown = fit(count, room);
        const height = (rows: number) => rows * ROW + Math.max(rows - 1, 0) * GAP;
        if (shown > 0) expect(height(shown), `${shown} of ${count} rows in ${room}`).toBeLessThanOrEqual(room);
        if (shown < count) expect(height(shown + 1), `one more of ${count} rows in ${room}`).toBeGreaterThan(room);
      }
    }
  });

  it('never shows fewer rows for more room', () => {
    for (let count = 0; count <= 12; count += 1) {
      let before = 0;
      for (let room = 0; room <= 700; room += 1) {
        const shown = fit(count, room);
        expect(shown, `${count} rows in ${room}`).toBeGreaterThanOrEqual(before);
        before = shown;
      }
    }
  });
});

describe('homeRows', () => {
  // An instant, not a date: this rule is a length of time and takes no zone.
  const NOW = Date.parse('2026-10-01T19:21:00-05:00');
  const SECOND = 1_000;
  const item = (id: string, crossedAt: number | null = null): ListItem => ({
    id,
    list_id: 'groceries',
    text: id,
    crossed_at: crossedAt === null ? null : new Date(crossedAt).toISOString(),
    sort_order: 0,
  });
  const ids = (rows: ListItem[]) => rows.map((row) => row.id);
  // What was crossed off on this card, and when.
  const here = (entries: Record<string, number>) => new Map(Object.entries(entries));

  it('holds a row for four seconds', () => {
    expect(HOME_HOLD_MS).toBe(4 * SECOND);
  });

  it('draws the items still to get, in the list\x27s order', () => {
    const items = [item('milk'), item('eggs'), item('bananas')];
    expect(ids(homeRows(items, here({}), NOW))).toEqual(['milk', 'eggs', 'bananas']);
    expect(homeRows([], here({}), NOW)).toEqual([]);
  });

  it('keeps an item crossed off on this card where it was, for four seconds', () => {
    // Eggs was crossed off here a second ago: it stays between Milk and Bananas.
    const items = [item('milk'), item('eggs', NOW - SECOND), item('bananas')];
    expect(ids(homeRows(items, here({ eggs: NOW - SECOND }), NOW))).toEqual(['milk', 'eggs', 'bananas']);
    // And still does a moment before the four seconds are up.
    expect(ids(homeRows(items, here({ eggs: NOW - HOME_HOLD_MS + 1 }), NOW))).toEqual(['milk', 'eggs', 'bananas']);
  });

  it('lets it go four seconds after it was crossed off', () => {
    const items = [item('milk'), item('eggs', NOW - HOME_HOLD_MS), item('bananas')];
    expect(ids(homeRows(items, here({ eggs: NOW - HOME_HOLD_MS }), NOW))).toEqual(['milk', 'bananas']);
    expect(ids(homeRows(items, here({ eggs: NOW - HOME_HOLD_MS - 60 * SECOND }), NOW))).toEqual(['milk', 'bananas']);
  });

  it('gives each row its own four seconds, from the moment it was crossed off', () => {
    // Milk was crossed off five seconds ago and Eggs one second ago: Milk has gone, and Eggs has three seconds left.
    const items = [item('milk', NOW - 5 * SECOND), item('eggs', NOW - SECOND), item('bananas')];
    const crossed = here({ milk: NOW - 5 * SECOND, eggs: NOW - SECOND });
    expect(ids(homeRows(items, crossed, NOW))).toEqual(['eggs', 'bananas']);
    expect(ids(homeRows(items, crossed, NOW + 3 * SECOND - 1))).toEqual(['eggs', 'bananas']);
    expect(ids(homeRows(items, crossed, NOW + 3 * SECOND))).toEqual(['bananas']);
  });

  it('draws an item that was crossed off here and put back as an open row, however long ago', () => {
    const items = [item('milk'), item('eggs'), item('bananas')];
    expect(ids(homeRows(items, here({ eggs: NOW - SECOND }), NOW))).toEqual(['milk', 'eggs', 'bananas']);
    expect(ids(homeRows(items, here({ eggs: NOW - 60 * SECOND }), NOW))).toEqual(['milk', 'eggs', 'bananas']);
  });

  it('never draws an item crossed off anywhere else', () => {
    // Coffee is crossed off, but not on this card: it is for the Lists screen until someone clears it.
    const items = [item('milk'), item('coffee', NOW - SECOND), item('bananas')];
    expect(ids(homeRows(items, here({}), NOW))).toEqual(['milk', 'bananas']);
    // Nor does another item's entry bring it back.
    expect(ids(homeRows(items, here({ milk: NOW - SECOND }), NOW))).toEqual(['milk', 'bananas']);
  });

  it('does not draw an item deleted elsewhere, though this card remembers crossing it off', () => {
    const items = [item('milk'), item('bananas')];
    expect(ids(homeRows(items, here({ eggs: NOW - SECOND }), NOW))).toEqual(['milk', 'bananas']);
  });

  it('does not change the items it is given', () => {
    const items = [item('milk'), item('eggs', NOW - SECOND)];
    homeRows(items, here({}), NOW);
    expect(ids(items)).toEqual(['milk', 'eggs']);
  });
});

describe('pinnedFirst', () => {
  const list = (id: string, sortOrder: number): SharedList => ({ id, name: id, sort_order: sortOrder });
  const groceries = list('groceries', 0);
  const costco = list('costco', 1);
  const camping = list('camping', 2);
  const ids = (lists: SharedList[]) => lists.map((each) => each.id);

  it('puts the Pinned List first and keeps the others in their order', () => {
    expect(ids(pinnedFirst([groceries, costco, camping], 'camping'))).toEqual(['camping', 'groceries', 'costco']);
    expect(ids(pinnedFirst([groceries, costco, camping], 'costco'))).toEqual(['costco', 'groceries', 'camping']);
  });

  it('leaves the order alone when the Pinned List is already first', () => {
    expect(ids(pinnedFirst([groceries, costco, camping], 'groceries'))).toEqual(['groceries', 'costco', 'camping']);
  });

  it('leaves the order alone when no list is pinned, or the pinned one is gone', () => {
    expect(ids(pinnedFirst([groceries, costco, camping], null))).toEqual(['groceries', 'costco', 'camping']);
    expect(ids(pinnedFirst([groceries, costco, camping], 'deleted'))).toEqual(['groceries', 'costco', 'camping']);
    expect(pinnedFirst([], 'groceries')).toEqual([]);
  });

  it('does not change the list it is given', () => {
    const lists = [groceries, costco, camping];
    pinnedFirst(lists, 'camping');
    expect(ids(lists)).toEqual(['groceries', 'costco', 'camping']);
  });
});
