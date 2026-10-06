import { describe, expect, it } from 'vitest';
import { homeLayout } from '../src/lib/home-layout';

// Home gives up a day column below 1200 px wide and an Up next tile below 760 px tall, so the day columns and the list card keep room.
describe('homeLayout', () => {
  it.each([
    [1280, 800, { days: 5, tiles: 3 }],
    [1024, 768, { days: 4, tiles: 3 }],
    [1280, 720, { days: 5, tiles: 2 }],
    [1920, 1200, { days: 5, tiles: 3 }],
    [1200, 760, { days: 5, tiles: 3 }],
    [1199, 759, { days: 4, tiles: 2 }],
  ])('%i x %i', (width, height, expected) => {
    expect(homeLayout({ width, height })).toMatchObject(expected);
  });
});

// Below 768 px of width the Wall is laid out for a phone; the width alone decides, whatever the height is.
describe('homeLayout, the phone', () => {
  it('is a phone at 767 px wide and not at 768', () => {
    expect(homeLayout({ width: 767, height: 800 }).phone).toBe(true);
    expect(homeLayout({ width: 768, height: 800 }).phone).toBe(false);
  });

  it('is not a phone at a width of 0, a window that has not been laid out yet', () => {
    expect(homeLayout({ width: 0, height: 0 }).phone).toBe(false);
    expect(homeLayout({ width: 0, height: 800 }).phone).toBe(false);
    expect(homeLayout({ width: 1, height: 800 }).phone).toBe(true);
  });

  it('is decided by the width alone, never the height', () => {
    expect(homeLayout({ width: 390, height: 844 }).phone).toBe(true);
    expect(homeLayout({ width: 390, height: 2000 }).phone).toBe(true);
    expect(homeLayout({ width: 1024, height: 300 }).phone).toBe(false);
    expect(homeLayout({ width: 1280, height: 800 }).phone).toBe(false);
  });

  it('leaves the days and the tiles as they were on a tablet, at the widths they were tested at', () => {
    expect(homeLayout({ width: 1024, height: 768 })).toEqual({ days: 4, tiles: 3, phone: false });
    expect(homeLayout({ width: 768, height: 720 })).toEqual({ days: 4, tiles: 2, phone: false });
    expect(homeLayout({ width: 1280, height: 800 })).toEqual({ days: 5, tiles: 3, phone: false });
  });
});
