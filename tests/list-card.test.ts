import { describe, expect, it } from 'vitest';
import { pinnedFirst, rowsThatFit, type SharedList } from '../src/lib/shared-lists';

// Pure rules for a Shared List's card on the Wall: how many of its rows Home's card holds, and which list comes first on
// the Lists screen. They run without the local stack.

// Home's card, from the drawing (v2/home.js): a row is 48 px, the gap between rows 8, and "and N more" is a button, so 48.
const ROW = 48;
const GAP = 8;
const MORE = 48;
const fit = (count: number, room: number, more = MORE) => rowsThatFit({ count, room, row: ROW, gap: GAP, more });

describe('rowsThatFit', () => {
  it('shows nothing for a list with no rows, whatever the room', () => {
    expect(fit(0, 0)).toBe(0);
    expect(fit(0, 500)).toBe(0);
  });

  it('shows every row, and no button, when they all fit', () => {
    // Three rows are 3 x 48 + 2 x 8 = 160 tall.
    expect(fit(3, 160)).toBe(3);
    expect(fit(3, 400)).toBe(3);
    expect(fit(1, 48)).toBe(1);
  });

  it('holds rows back for the "and N more" button when they do not all fit', () => {
    // One pixel short of all three: two rows and the button need 2 x (48 + 8) + 48 = 160, so one row and the button.
    expect(fit(3, 159)).toBe(1);
    // Room for three rows and the button is 3 x 56 + 48 = 216, for two 160, for one 104.
    expect(fit(10, 216)).toBe(3);
    expect(fit(10, 215)).toBe(2);
    expect(fit(10, 160)).toBe(2);
    expect(fit(10, 104)).toBe(1);
  });

  it('shows no row when none fits above the button, down to no room at all', () => {
    // One row and the button need 104; whether the button itself fits (48) is for the card to say.
    expect(fit(5, 103)).toBe(0);
    expect(fit(5, 48)).toBe(0);
    expect(fit(5, 47)).toBe(0);
    expect(fit(5, 0)).toBe(0);
    expect(fit(5, -20)).toBe(0);
  });

  it('is the drawing\'s card at 256 px: two rows under a 20 px line, but one under a 48 px button', () => {
    // 256 less 24 of padding, a 32 head, a 52 add row and two 8 gaps leaves 132.
    const room = 256 - 24 - 32 - 52 - 16;
    expect(fit(4, room, 20)).toBe(2);
    expect(fit(4, room)).toBe(1);
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
        const all = count * ROW + (count - 1) * GAP;
        if (shown === count) {
          expect(all, `${count} rows in ${room}`).toBeLessThanOrEqual(room);
        } else {
          if (shown > 0) expect(shown * (ROW + GAP) + MORE, `${shown} of ${count} rows in ${room}`).toBeLessThanOrEqual(room);
          const oneMoreFits = shown + 1 === count ? all <= room : (shown + 1) * (ROW + GAP) + MORE <= room;
          expect(oneMoreFits, `one more of ${count} rows in ${room}`).toBe(false);
        }
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
