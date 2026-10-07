import { describe, expect, it } from 'vitest';
import { homeLayout, viewportToLayOut } from '../src/lib/home-layout';

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

// A tablet hung upright (docs/specs/0009): at 768 px and wider, a viewport taller than it is wide, by the viewport alone.
describe('homeLayout, portrait', () => {
  it('is portrait on the Lenovo Tab P12 upright, at either Display size, and holds four days and three tiles', () => {
    expect(homeLayout({ width: 920, height: 1472 })).toEqual({ days: 4, tiles: 3, phone: false, portrait: true });
    expect(homeLayout({ width: 1082, height: 1732 })).toEqual({ days: 4, tiles: 3, phone: false, portrait: true });
  });

  it('is landscape on the P12 on its side, where nothing changes: five days and three tiles', () => {
    expect(homeLayout({ width: 1472, height: 920 })).toEqual({ days: 5, tiles: 3, phone: false, portrait: false });
    expect(homeLayout({ width: 1732, height: 1082 })).toEqual({ days: 5, tiles: 3, phone: false, portrait: false });
  });

  it('is portrait from 768 px wide, a phone below it whatever the height, landscape when square, and neither at 0', () => {
    expect(homeLayout({ width: 768, height: 1024 }).portrait).toBe(true);
    expect(homeLayout({ width: 767, height: 1024 })).toMatchObject({ phone: true, portrait: false });
    expect(homeLayout({ width: 1000, height: 1000 }).portrait).toBe(false);
    expect(homeLayout({ width: 0, height: 0 })).toMatchObject({ phone: false, portrait: false });
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
    expect(homeLayout({ width: 1024, height: 768 })).toEqual({ days: 4, tiles: 3, phone: false, portrait: false });
    expect(homeLayout({ width: 768, height: 720 })).toEqual({ days: 4, tiles: 2, phone: false, portrait: false });
    expect(homeLayout({ width: 1280, height: 800 })).toEqual({ days: 5, tiles: 3, phone: false, portrait: false });
  });
});

// Larger text (a root font size above 16 px) makes every rem box bigger and leaves the screen as it is, so the Wall holds what the
// smaller screen it is then would: the width and the height are judged in rem, as they would be at 16 px. 1280 x 800 at 130 percent
// (20.8 px) has the room of 984 x 615, and at 200 percent (32 px) of 640 x 400, which the Wall is never shorter than 34 rem of.
describe('homeLayout, larger text', () => {
  it('is the same at 16 px text, whether or not the size is given', () => {
    expect(homeLayout({ width: 1280, height: 800, rem: 16 })).toEqual(homeLayout({ width: 1280, height: 800 }));
    expect(homeLayout({ width: 1024, height: 768, rem: 16 })).toEqual({ days: 4, tiles: 3, phone: false, portrait: false });
  });

  it('gives up a day and an Up next tile at 130 percent', () => {
    expect(homeLayout({ width: 1280, height: 800, rem: 20.8 })).toEqual({ days: 4, tiles: 2, phone: false, portrait: false });
  });

  it('holds three days and one tile at 200 percent', () => {
    expect(homeLayout({ width: 1280, height: 800, rem: 32 })).toEqual({ days: 3, tiles: 1, phone: false, portrait: false });
  });

  it('never holds one tile at 16 px text, however short the screen is', () => {
    expect(homeLayout({ width: 1280, height: 400 }).tiles).toBe(2);
  });

  it('takes the Wall to be 34 rem tall at least, so a tall text size on a short screen asks for no fewer tiles than a short one', () => {
    expect(homeLayout({ width: 1280, height: 300, rem: 16 }).tiles).toBe(2);
    // 1280 x 600 at 200 percent is 640 x 300 rem-wise, but the Wall is 34 rem (1088 px) tall, which is 544 at 16 px text.
    expect(homeLayout({ width: 1280, height: 600, rem: 32 }).tiles).toBe(1);
    expect(homeLayout({ width: 1280, height: 1300, rem: 32 }).tiles).toBe(2);
    expect(homeLayout({ width: 1920, height: 1600, rem: 20.8 }).tiles).toBe(3);
  });

  it('stays a phone below 768 px whatever the text size is, and keeps its four days at 16 px text on a narrow tablet', () => {
    expect(homeLayout({ width: 767, height: 800, rem: 32 }).phone).toBe(true);
    expect(homeLayout({ width: 768, height: 800, rem: 32 }).phone).toBe(false);
    expect(homeLayout({ width: 768, height: 720 }).days).toBe(4);
  });
});

// The keyboard hold: the same width and a smaller height, while a field is in play, is the keyboard and keeps the room.
describe('viewportToLayOut', () => {
  const room = { width: 920, height: 1472 };

  it('keeps the room for the same width and a smaller height while a field is in play', () => {
    expect(viewportToLayOut({ width: 920, height: 870, room, keyboardMayBeUp: true })).toBe(room);
  });

  it('takes the new size for a different width, even while a field is in play', () => {
    expect(viewportToLayOut({ width: 1472, height: 920, room, keyboardMayBeUp: true })).toEqual({ width: 1472, height: 920 });
  });

  it('takes the new size for a height that is not smaller', () => {
    expect(viewportToLayOut({ width: 920, height: 1472, room, keyboardMayBeUp: true })).toEqual({ width: 920, height: 1472 });
    expect(viewportToLayOut({ width: 920, height: 1600, room, keyboardMayBeUp: true })).toEqual({ width: 920, height: 1600 });
  });

  it('takes the new size when no field is in play, and when there is no room yet', () => {
    expect(viewportToLayOut({ width: 920, height: 870, room, keyboardMayBeUp: false })).toEqual({ width: 920, height: 870 });
    expect(viewportToLayOut({ width: 920, height: 870, room: null, keyboardMayBeUp: true })).toEqual({ width: 920, height: 870 });
  });
});
