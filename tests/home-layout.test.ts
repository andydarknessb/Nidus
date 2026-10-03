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
    expect(homeLayout({ width, height })).toEqual(expected);
  });
});
