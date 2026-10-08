import { describe, expect, it } from 'vitest';
import { byPosition, movedIds, nextSortOrder } from '../src/lib/ordering';

// Position: how Profiles, Routines, Shared Lists and their items are ordered, moved and appended, from one module.

describe('ordering by position', () => {
  it('orders by position without touching the rows it was given', () => {
    const rows = [{ sort_order: 2 }, { sort_order: 0 }, { sort_order: 1 }];
    expect(byPosition(rows).map((row) => row.sort_order)).toEqual([0, 1, 2]);
    expect(rows.map((row) => row.sort_order)).toEqual([2, 0, 1]);
  });

  it('puts new rows at the bottom', () => {
    expect(nextSortOrder([{ sort_order: 2 }, { sort_order: 0 }, { sort_order: 1 }])).toBe(3);
    expect(nextSortOrder([])).toBe(0);
    expect(nextSortOrder([{ sort_order: 0 }, { sort_order: 4 }])).toBe(5);
  });

  it('moves an id by an offset, clamped to the ends', () => {
    expect(movedIds(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(movedIds(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c']);
    expect(movedIds(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(movedIds(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
    expect(movedIds(['a', 'b', 'c'], 'a', 5)).toEqual(['b', 'c', 'a']);
  });

  it('leaves the order as it is for an id that is not there', () => {
    expect(movedIds(['a', 'b'], 'zzz', 1)).toEqual(['a', 'b']);
  });
});
