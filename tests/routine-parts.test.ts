import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as lucide from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { PictureField, RoutinePicture } from '../src/lib/routine-pictures';
import { partOfDay } from '../src/lib/routines';
import { dayStartMs, instantAt } from '../supabase/functions/_shared/zoned-time.ts';

// The part of the day and the Routine pictures. Everything here is pure: the Household Timezone is always an argument, and no test
// reads the machine's zone or needs the local stack. The rest of today's Routines is tests/routine-chart.test.ts.

const CHICAGO = 'America/Chicago';

// ---- Which part of the day it is ------------------------------------------------------------------

describe('which part of the day it is', () => {
  // A Household wall-clock time as an instant, so every case reads as the clock on the wall.
  const at = (date: string, time: string, timezone = CHICAGO) => new Date(instantAt(date, time, timezone));
  const partAt = (date: string, time: string, timezone = CHICAGO) => partOfDay(timezone, at(date, time, timezone));

  it('is morning from midnight until 12:00, afternoon from 12:00 and evening from 17:00', () => {
    expect(partAt('2026-10-02', '00:00')).toBe('morning');
    expect(partAt('2026-10-02', '11:59')).toBe('morning');
    expect(partAt('2026-10-02', '12:00')).toBe('afternoon');
    expect(partAt('2026-10-02', '16:59')).toBe('afternoon');
    expect(partAt('2026-10-02', '17:00')).toBe('evening');
    expect(partAt('2026-10-02', '23:59')).toBe('evening');
  });

  it('counts midnight to 5:00 as morning, so nothing of a new day is left from earlier', () => {
    for (const time of ['00:00', '00:01', '03:30', '04:59', '05:00']) expect(partAt('2026-10-02', time), time).toBe('morning');
  });

  it('follows the Household Timezone, not the machine\'s: the same instant is a different part in another zone', () => {
    // 19:00 Thursday in Chicago (CDT, UTC-5) is 13:00 Friday in Auckland (NZDT, UTC+13) and midnight in UTC.
    const instant = at('2026-10-01', '19:00');
    expect(partOfDay(CHICAGO, instant)).toBe('evening');
    expect(partOfDay('Pacific/Auckland', instant)).toBe('afternoon');
    expect(partOfDay('UTC', instant)).toBe('morning');
  });

  it('follows the wall clock on the 23 hour day clocks go forward, where 11 hours after midnight is already noon', () => {
    // Chicago, Sunday 2026-03-08: 02:00 CST becomes 03:00 CDT, so the day is 23 hours long.
    const midnight = dayStartMs('2026-03-08', CHICAGO);
    expect(partOfDay(CHICAGO, new Date(midnight + 11 * 3_600_000))).toBe('afternoon'); // 12:00 CDT
    expect(partOfDay(CHICAGO, new Date(midnight + 11 * 3_600_000 - 1))).toBe('morning'); // 11:59:59 CDT
    expect(partOfDay(CHICAGO, new Date(midnight + 16 * 3_600_000))).toBe('evening'); // 17:00 CDT
    expect(partOfDay(CHICAGO, new Date(midnight + 16 * 3_600_000 - 1))).toBe('afternoon'); // 16:59:59 CDT
    expect(partAt('2026-03-08', '11:59')).toBe('morning');
    expect(partAt('2026-03-08', '12:00')).toBe('afternoon');
  });

  it('follows the wall clock on the 25 hour day clocks go back, where 12 hours after midnight is still morning', () => {
    // Chicago, Sunday 2026-11-01: 02:00 CDT becomes 01:00 CST, so the day is 25 hours long.
    const midnight = dayStartMs('2026-11-01', CHICAGO);
    expect(partOfDay(CHICAGO, new Date(midnight + 12 * 3_600_000))).toBe('morning'); // 11:00 CST
    expect(partOfDay(CHICAGO, new Date(midnight + 13 * 3_600_000))).toBe('afternoon'); // 12:00 CST
    expect(partOfDay(CHICAGO, new Date(midnight + 17 * 3_600_000))).toBe('afternoon'); // 16:00 CST
    expect(partOfDay(CHICAGO, new Date(midnight + 18 * 3_600_000))).toBe('evening'); // 17:00 CST
    // The hour that happens twice is morning both times.
    expect(partOfDay(CHICAGO, new Date(Date.UTC(2026, 10, 1, 6, 30)))).toBe('morning'); // 01:30 CDT
    expect(partOfDay(CHICAGO, new Date(Date.UTC(2026, 10, 1, 7, 30)))).toBe('morning'); // 01:30 CST
  });

  it('changes at the instant a part begins and not before', () => {
    const noon = instantAt('2026-10-02', '12:00', CHICAGO);
    expect(partOfDay(CHICAGO, new Date(noon - 1))).toBe('morning');
    expect(partOfDay(CHICAGO, new Date(noon))).toBe('afternoon');
    expect(partOfDay(CHICAGO, new Date(noon + 59_999))).toBe('afternoon');
  });
});

// ---- Pictures -------------------------------------------------------------------------------------------

describe('Routine pictures', () => {
  // The "Routine pictures" table of docs/look.md: two (key, icon) pairs on each row, read left to right and top to bottom.
  const lines = readFileSync(new URL('../docs/look.md', import.meta.url), 'utf8').split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith('| Key | Icon | Key | Icon |'));
  if (start < 0) throw new Error('docs/look.md has no Routine pictures table');
  const rows: string[][] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break;
    rows.push(line.split('|').slice(1, -1).map((cell) => cell.trim().replace(/^`(.*)`$/, '$1')));
  }
  const documented = rows.flatMap(([key, icon, otherKey, otherIcon]) => [[key!, icon!] as const, [otherKey!, otherIcon!] as const]);
  // 'shower-head' is lucide-react's ShowerHead.
  const component = (name: string) => (lucide as unknown as Record<string, lucide.LucideIcon | undefined>)[name.split('-').map((word) => word[0]!.toUpperCase() + word.slice(1)).join('')];

  const draw = (picture: string | null, size?: number) => renderToStaticMarkup(createElement(RoutinePicture, size === undefined ? { picture } : { picture, size }));
  const circle = renderToStaticMarkup(createElement(lucide.Circle, { 'aria-hidden': true, size: 28 }));

  // The picker as the phone's form draws it: its radios, each with the key it holds, the words a screen reader says for it, and
  // whether it is the one chosen.
  const pick = (picture: string | null) => {
    const markup = renderToStaticMarkup(createElement(PictureField, { about: "Ava's new routine", picture, onChange: () => undefined }));
    const radios = (markup.match(/<input[^>]*type="radio"[^>]*>/g) ?? []).map((tag) => ({
      key: /value="([^"]*)"/.exec(tag)?.[1],
      name: /aria-label="([^"]*)"/.exec(tag)?.[1],
      checked: /\schecked(=|\s|\/|>)/.test(tag),
    }));
    return { markup, radios };
  };

  it('offers the two dozen keys of docs/look.md in its order, and "No picture" first', () => {
    expect(documented).toHaveLength(24);
    const { markup, radios } = pick(null);
    expect(radios.map((radio) => radio.key)).toEqual(['', ...documented.map(([key]) => key)]);
    expect(markup).toContain('No picture');
  });

  it('draws the icon docs/look.md names for each key', () => {
    for (const [key, icon] of documented) {
      const Icon = component(icon);
      expect(Icon, `lucide-react has ${icon}`).toBeDefined();
      expect(draw(key), key).toBe(renderToStaticMarkup(createElement(Icon!, { 'aria-hidden': true, size: 28 })));
    }
  });

  it('draws the picture at the size it is asked for', () => {
    expect(draw('bed', 52)).toBe(renderToStaticMarkup(createElement(lucide.Bed, { 'aria-hidden': true, size: 52 })));
  });

  it('names each picture in the grid in words a screen reader can say, one each', () => {
    const names = pick(null).radios.slice(1).map((radio) => radio.name);
    expect(names).toHaveLength(24);
    expect(names.every((name) => name !== undefined && name.trim().length > 0)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
    expect(pick(null).radios.find((radio) => radio.key === 'teeth')?.name).toBe('Brush teeth');
  });

  it('draws a plain circle for no key and for a key the app does not know', () => {
    for (const unknown of [null, '', 'unicorn', 'Teeth', 'teeth ', 'a'.repeat(32)]) expect(draw(unknown), String(unknown)).toBe(circle);
  });

  it('draws the picture itself, and not a circle, for a key it knows', () => {
    for (const [key] of documented) expect(draw(key), key).not.toBe(circle);
  });

  it('hides the picture from a screen reader, since the words beside it say the same', () => {
    expect(draw('bed')).toContain('aria-hidden="true"');
    expect(draw(null)).toContain('aria-hidden="true"');
  });

  it("checks the picture the Routine has, and 'No picture' when it has none", () => {
    expect(pick('bed').radios.filter((radio) => radio.checked).map((radio) => radio.key)).toEqual(['bed']);
    expect(pick(null).radios.filter((radio) => radio.checked).map((radio) => radio.key)).toEqual(['']);
    expect(pick('bed').markup).toContain('Bed');
  });

  it('keeps a key it does not know, checking none and saying so, rather than showing the Routine as having no picture', () => {
    const { markup, radios } = pick('juggling');
    const row = /<summary[\s\S]*?<\/summary>/.exec(markup)?.[0] ?? '';
    expect(radios.some((radio) => radio.checked)).toBe(false);
    expect(row).toContain('Another picture');
    expect(row).not.toContain('No picture');
    expect(/<summary[\s\S]*?<\/summary>/.exec(pick(null).markup)?.[0]).toContain('No picture');
  });
});
