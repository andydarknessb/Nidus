import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as lucide from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { dayStartMs } from '../src/lib/calendar-occurrences';
import { wallMs } from '../src/lib/native-events';
import type { Profile } from '../src/lib/profiles';
import { PictureField, RoutinePicture } from '../src/lib/routine-pictures';
import {
  PARTS,
  TICK_FAILED,
  TICK_OFFLINE,
  afterTick,
  columnsOf,
  followClock,
  holdShown,
  maskOf,
  openChart,
  partDone,
  partOfDay,
  partView,
  pickPart,
  todaysRoutines,
  upNext,
  upNextLink,
  type Chart,
  type ProfileRoutines,
  type Routine,
  type TimeOfDay,
} from '../src/lib/routines';

// Everything here is pure: the Household Timezone is always an argument, and no test reads the machine's zone or
// needs the local stack.

const CHICAGO = 'America/Chicago';
const NONE: ReadonlySet<string> = new Set();

function routine(id: string, timeOfDay: TimeOfDay | null, sortOrder = 0, overrides: Partial<Routine> = {}): Routine {
  return { id, profile_id: 'p1', title: id, days_of_week: 127, time_of_day: timeOfDay, picture: null, sort_order: sortOrder, archived_at: null, ...overrides };
}

function profile(id: string, sortOrder: number, name = id): Profile {
  return { id, name, color: '#93c5fd', avatar_url: null, sort_order: sortOrder };
}

const ids = (rows: Routine[]) => rows.map((row) => row.id);

// ---- Which part of the day it is ------------------------------------------------------------------

describe('which part of the day it is', () => {
  // A Household wall-clock time as an instant, so every case reads as the clock on the wall.
  const at = (date: string, time: string, timezone = CHICAGO) => new Date(wallMs(date, time, timezone));
  const partAt = (date: string, time: string, timezone = CHICAGO) => partOfDay(timezone, at(date, time, timezone));

  it('lists the parts in the order the day happens', () => {
    expect(PARTS).toEqual(['morning', 'afternoon', 'evening']);
  });

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
    const noon = wallMs('2026-10-02', '12:00', CHICAGO);
    expect(partOfDay(CHICAGO, new Date(noon - 1))).toBe('morning');
    expect(partOfDay(CHICAGO, new Date(noon))).toBe('afternoon');
    expect(partOfDay(CHICAGO, new Date(noon + 59_999))).toBe('afternoon');
  });
});

// ---- What a part shows ----------------------------------------------------------------------------

describe('what a part shows', () => {
  // Ava's day in the drawings: three Routines done before the evening, one for the evening and one for any time.
  const ava = [
    routine('teeth', 'morning', 0),
    routine('dressed', 'morning', 1),
    routine('homework', 'afternoon', 2),
    routine('dog', 'evening', 3),
    routine('read', null, 4),
  ];
  const afternoonDone = new Set(['teeth', 'dressed', 'homework']);

  it("shows the part's own Routines, then what is left from earlier, then Any time", () => {
    const view = partView([routine('dog', 'evening'), routine('later', 'evening', 1), routine('any', null, 2), routine('left', 'morning', 3)], NONE, 'evening');
    expect(ids(view.own)).toEqual(['dog', 'later']);
    expect(ids(view.earlier)).toEqual(['left']);
    expect(ids(view.anytime)).toEqual(['any']);
    expect(view.doneEarlier).toBe(0);
  });

  it('is the drawing for the evening: its own, Any time, and the three done earlier counted in the foot line', () => {
    const view = partView(ava, afternoonDone, 'evening');
    expect(ids(view.own)).toEqual(['dog']);
    expect(ids(view.earlier)).toEqual([]);
    expect(ids(view.anytime)).toEqual(['read']);
    expect(view.doneEarlier).toBe(3);
  });

  it('keeps each group in its Routines\' own order, whatever order they arrive in', () => {
    const rows = [routine('b', 'evening', 5), routine('a', 'evening', 1), routine('y', null, 9), routine('x', null, 2)];
    const view = partView(rows, NONE, 'evening');
    expect(ids(view.own)).toEqual(['a', 'b']);
    expect(ids(view.anytime)).toEqual(['x', 'y']);
    // The list it was given is left as it was.
    expect(ids(rows)).toEqual(['b', 'a', 'y', 'x']);
  });

  it('shows its own Routines whether they are ticked or not', () => {
    const view = partView([routine('a', 'afternoon'), routine('b', 'afternoon', 1)], new Set(['a']), 'afternoon');
    expect(ids(view.own)).toEqual(['a', 'b']);
  });

  it('shows Any time Routines in every part, ticked or not, and never counts them in the foot line', () => {
    const rows = [routine('any', null)];
    for (const part of PARTS) {
      expect(ids(partView(rows, NONE, part).anytime), part).toEqual(['any']);
      expect(ids(partView(rows, new Set(['any']), part).anytime), part).toEqual(['any']);
      expect(partView(rows, new Set(['any']), part).doneEarlier, part).toBe(0);
    }
  });

  it('never shows a Routine of a later part, and never counts it', () => {
    const rows = [routine('m', 'morning'), routine('a', 'afternoon', 1), routine('e', 'evening', 2)];
    const morning = partView(rows, new Set(['e', 'a']), 'morning');
    expect(ids(morning.own)).toEqual(['m']);
    expect(morning.earlier).toEqual([]);
    expect(morning.doneEarlier).toBe(0);
    const afternoon = partView(rows, new Set(['e']), 'afternoon');
    expect(ids(afternoon.own)).toEqual(['a']);
    expect(afternoon.doneEarlier).toBe(0);
  });

  it('has nothing left from earlier in the morning, which begins at midnight', () => {
    const view = partView(ava, NONE, 'morning');
    expect(ids(view.own)).toEqual(['teeth', 'dressed']);
    expect(view.earlier).toEqual([]);
    expect(view.doneEarlier).toBe(0);
  });
});

describe('left from earlier', () => {
  const rows = [routine('m1', 'morning', 0), routine('m2', 'morning', 1), routine('a1', 'afternoon', 2), routine('e1', 'evening', 3)];

  it('is every Routine of an earlier part that is not ticked, the morning\'s first and each part in its own order', () => {
    expect(ids(partView(rows, NONE, 'evening').earlier)).toEqual(['m1', 'm2', 'a1']);
    expect(ids(partView(rows, new Set(['m2']), 'evening').earlier)).toEqual(['m1', 'a1']);
    expect(ids(partView(rows, NONE, 'afternoon').earlier)).toEqual(['m1', 'm2']);
  });

  it('counts the earlier Routines that are ticked and not shown, for the foot line', () => {
    const view = partView(rows, new Set(['m1', 'a1']), 'evening');
    expect(ids(view.earlier)).toEqual(['m2']);
    expect(view.doneEarlier).toBe(2);
    expect(partView(rows, new Set(['m1', 'm2', 'a1']), 'evening').doneEarlier).toBe(3);
  });

  it('brings a Routine back when it is unticked', () => {
    expect(ids(partView(rows, new Set(['m1']), 'afternoon').earlier)).toEqual(['m2']);
    expect(ids(partView(rows, NONE, 'afternoon').earlier)).toEqual(['m1', 'm2']);
  });
});

describe('a Routine ticked while it is shown', () => {
  const rows = [routine('m1', 'morning', 0), routine('m2', 'morning', 1), routine('e1', 'evening', 2)];

  it('stays where it is, done, once it is held', () => {
    const held = new Set(['m1']);
    const view = partView(rows, new Set(['m1']), 'evening', held);
    expect(ids(view.earlier)).toEqual(['m1', 'm2']);
    // It is shown, so it is not counted among the Routines done and not shown.
    expect(view.doneEarlier).toBe(0);
  });

  it('is counted in the foot line instead when it was never held, as one ticked before the part began', () => {
    const view = partView(rows, new Set(['m1']), 'evening', NONE);
    expect(ids(view.earlier)).toEqual(['m2']);
    expect(view.doneEarlier).toBe(1);
  });

  it('is held once the chart has shown it unticked, until the part changes', () => {
    let chart = openChart('evening');
    // The chart is drawn: m1 and m2 are shown, not ticked.
    chart = holdShown(chart, ids(partView(rows, NONE, 'evening', chart.held).earlier));
    // A child ticks m1: it stays, done.
    const ticked = new Set(['m1']);
    chart = holdShown(chart, ids(partView(rows, ticked, 'evening', chart.held).earlier));
    expect(ids(partView(rows, ticked, 'evening', chart.held).earlier)).toEqual(['m1', 'm2']);
    expect(partView(rows, ticked, 'evening', chart.held).doneEarlier).toBe(0);
    // The part changes (here by hand, to the afternoon and back): it is let go, and counted in the foot line.
    chart = pickPart(pickPart(chart, 'afternoon'), 'evening');
    expect(ids(partView(rows, ticked, 'evening', chart.held).earlier)).toEqual(['m2']);
    expect(partView(rows, ticked, 'evening', chart.held).doneEarlier).toBe(1);
  });

  it('ignores a held Routine that is not from an earlier part: its own and Any time Routines show anyway', () => {
    const view = partView(rows, NONE, 'evening', new Set(['e1', 'nobody']));
    expect(ids(view.own)).toEqual(['e1']);
    expect(ids(view.earlier)).toEqual(['m1', 'm2']);
  });
});

describe('a part being done', () => {
  const rows = [routine('m', 'morning', 0), routine('e1', 'evening', 1), routine('e2', 'evening', 2), routine('any', null, 3)];

  it('says so when everything shown for it is ticked: its own, what is left from earlier, and Any time', () => {
    const everything = new Set(['m', 'e1', 'e2', 'any']);
    expect(partDone(partView(rows, everything, 'evening'), everything)).toBe(true);
    // Left from earlier and Any time count: a Routine of either that is not ticked keeps the evening open.
    expect(partDone(partView(rows, new Set(['e1', 'e2', 'any']), 'evening'), new Set(['e1', 'e2', 'any']))).toBe(false);
    expect(partDone(partView(rows, new Set(['m', 'e1', 'e2']), 'evening'), new Set(['m', 'e1', 'e2']))).toBe(false);
  });

  it('does not say so while one of its own is left', () => {
    const done = new Set(['m', 'e1', 'any']);
    expect(partDone(partView(rows, done, 'evening'), done)).toBe(false);
  });

  it('counts a held Routine, ticked, among what is shown and ticked', () => {
    const done = new Set(['m', 'e1', 'e2', 'any']);
    const view = partView(rows, done, 'evening', new Set(['m']));
    expect(ids(view.earlier)).toEqual(['m']);
    expect(partDone(view, done)).toBe(true);
  });

  it('is never said of a part that shows nothing', () => {
    const view = partView([routine('e', 'evening')], NONE, 'morning');
    expect(view.own).toEqual([]);
    expect(partDone(view, new Set(['e']))).toBe(false);
    expect(partDone(partView([], NONE, 'evening'), NONE)).toBe(false);
  });

  it('is not about the Routines of later parts, which it does not show', () => {
    const done = new Set(['m']);
    expect(partDone(partView(rows, done, 'morning'), done)).toBe(false); // the Any time one is shown, and left
    const everythingShown = new Set(['m', 'any']);
    expect(partDone(partView(rows, everythingShown, 'morning'), everythingShown)).toBe(true);
  });
});

// ---- The chart: which part it is on ---------------------------------------------------------------

describe('the chart opens on the part it is now and follows it', () => {
  it('opens on the part of the day it is in, holding nothing', () => {
    for (const part of PARTS) expect(openChart(part)).toEqual({ part, clock: part, held: new Set() });
  });

  it('moves to a new part when that part begins', () => {
    const evening = openChart('afternoon');
    const next = followClock(evening, 'evening');
    expect(next.part).toBe('evening');
    expect(next.clock).toBe('evening');
  });

  it('is left as it is while the clock stays in the part it was in', () => {
    const chart = openChart('morning');
    expect(followClock(chart, 'morning')).toBe(chart);
    const picked = pickPart(chart, 'evening');
    expect(followClock(picked, 'morning')).toBe(picked);
  });

  it('holds a part picked by hand until a new part begins, then follows the clock', () => {
    let chart: Chart = openChart('evening');
    chart = pickPart(chart, 'morning');
    expect(chart.part).toBe('morning');
    expect(followClock(chart, 'evening').part).toBe('morning');
    // Midnight: a new part begins, and the chart goes with it.
    expect(followClock(chart, 'morning').part).toBe('morning');
    const picked = pickPart(openChart('afternoon'), 'evening');
    expect(followClock(picked, 'evening')).toMatchObject({ part: 'evening', clock: 'evening' });
  });

  it('holds Whole day, picked by hand, until a new part begins', () => {
    const chart = pickPart(openChart('evening'), 'whole');
    expect(chart.part).toBe('whole');
    expect(followClock(chart, 'evening').part).toBe('whole');
    expect(followClock(chart, 'morning').part).toBe('morning');
  });

  it('lets go of what it held when it moves to another part, by hand or by the clock', () => {
    const held = holdShown(openChart('evening'), ['a', 'b']);
    expect([...held.held]).toEqual(['a', 'b']);
    expect(pickPart(held, 'afternoon').held.size).toBe(0);
    expect(followClock(held, 'morning').held.size).toBe(0);
    // Picking the part it is already on changes nothing.
    expect(pickPart(held, 'evening')).toBe(held);
  });

  it('keeps what it holds, and the same chart, when nothing new is shown', () => {
    const held = holdShown(openChart('evening'), ['a', 'b']);
    expect(holdShown(held, ['b', 'a'])).toBe(held);
    expect(holdShown(held, [])).toBe(held);
    expect([...holdShown(held, ['c']).held]).toEqual(['a', 'b', 'c']);
  });

  it('never changes the chart it is given', () => {
    const chart = openChart('evening');
    holdShown(chart, ['a']);
    pickPart(chart, 'whole');
    followClock(chart, 'morning');
    expect(chart).toEqual({ part: 'evening', clock: 'evening', held: new Set() });
  });
});

// ---- A column for every Profile that has a Routine on any day ----------------------------------------

describe('the any-day columns', () => {
  const sam = profile('sam', 1, 'Sam');
  const cory = profile('cory', 0, 'Cory');
  const ava = profile('ava', 2, 'Ava');
  const ben = profile('ben', 3, 'Ben');
  const MON = 1;
  const SAT = 6;

  it('has a column for every Profile with a Routine on any day, in Profile order', () => {
    const rows = [routine('a', null, 0, { profile_id: 'ava' }), routine('s', null, 0, { profile_id: 'sam' })];
    expect(columnsOf([ava, sam, cory, ben], rows, MON).map((column) => column.profile.id)).toEqual(['sam', 'ava']);
  });

  it('holds the Routines scheduled today, in order, and none for a Profile whose Routines are on other days', () => {
    const rows = [
      routine('s-mon', null, 1, { profile_id: 'sam', days_of_week: maskOf([MON]) }),
      routine('s-daily', null, 0, { profile_id: 'sam' }),
      routine('a-sat', null, 0, { profile_id: 'ava', days_of_week: maskOf([SAT]) }),
    ];
    const columns = columnsOf([cory, sam, ava], rows, MON);
    expect(columns.map((column) => [column.profile.id, ids(column.routines)])).toEqual([
      ['sam', ['s-daily', 's-mon']],
      ['ava', []],
    ]);
    // The same Profiles on Saturday: the columns do not move, only what is in them.
    expect(columnsOf([cory, sam, ava], rows, SAT).map((column) => [column.profile.id, ids(column.routines)])).toEqual([
      ['sam', ['s-daily']],
      ['ava', ['a-sat']],
    ]);
  });

  it('leaves out a Profile with no Routines at all, and one whose Routines are all archived', () => {
    const rows = [routine('old', null, 0, { profile_id: 'ben', archived_at: '2026-09-01T00:00:00Z' }), routine('a', null, 0, { profile_id: 'ava' })];
    expect(columnsOf([cory, ava, ben], rows, MON).map((column) => column.profile.id)).toEqual(['ava']);
    expect(columnsOf([cory, ava, ben], [], MON)).toEqual([]);
  });

  it('does not show an archived Routine in a column that is there for another', () => {
    const rows = [routine('old', null, 0, { profile_id: 'ava', archived_at: '2026-09-01T00:00:00Z' }), routine('a', null, 1, { profile_id: 'ava' })];
    expect(columnsOf([ava], rows, MON).map((column) => ids(column.routines))).toEqual([['a']]);
  });

  it('agrees with todaysRoutines for the Routines it puts in a column', () => {
    const rows = [routine('x', null, 0, { profile_id: 'ava', days_of_week: maskOf([MON]) }), routine('y', null, 1, { profile_id: 'ava', days_of_week: maskOf([SAT]) })];
    expect(columnsOf([ava], rows, MON)[0]!.routines).toEqual(todaysRoutines(rows, MON));
  });

  it('ignores Routines of a Profile that is not in the list', () => {
    expect(columnsOf([cory], [routine('x', null, 0, { profile_id: 'stranger' })], MON)).toEqual([]);
  });
});

// ---- Up next -------------------------------------------------------------------------------------------

describe('Up next', () => {
  const group = (p: Profile, rows: Routine[]): ProfileRoutines => ({ profile: p, routines: rows.map((row) => ({ ...row, profile_id: p.id })) });
  const cory = profile('cory', 0, 'Cory');
  const sam = profile('sam', 1, 'Sam');
  const ava = profile('ava', 2, 'Ava');
  const ben = profile('ben', 3, 'Ben');
  const shown = (result: ReturnType<typeof upNext>) => result.tiles.map((tile) => [tile.profile.id, tile.routine.id]);

  // The Evening drawing: Cory is done; Sam, Ava and Ben have one Routine each left in the evening and Sam and Ava one at any time.
  const drawing = [
    group(cory, [routine('bins', 'evening')]),
    group(sam, [routine('bed', 'morning'), routine('stretch', 'evening', 1), routine('plants', null, 2)]),
    group(ava, [routine('teeth', 'morning'), routine('dog', 'evening', 1), routine('read', null, 2)]),
    group(ben, [routine('toys', 'evening'), routine('brush', 'evening', 1)]),
  ];
  const drawingDone = new Set(['bins', 'bed', 'teeth', 'brush']);

  it('is a tile for each of the first people with something left, each showing the first Routine left', () => {
    const result = upNext(drawing, drawingDone, 'evening');
    expect(shown(result)).toEqual([
      ['sam', 'stretch'],
      ['ava', 'dog'],
      ['ben', 'toys'],
    ]);
  });

  it('gives a Profile with nothing left no tile', () => {
    expect(shown(upNext(drawing, drawingDone, 'evening')).map(([who]) => who)).not.toContain('cory');
    expect(upNext([group(cory, [routine('bins', 'evening')])], new Set(['bins']), 'evening')).toEqual({ tiles: [], more: 0 });
  });

  it('stops at three people, the first three in Profile order who have something left', () => {
    const four = [group(cory, [routine('a', 'evening')]), group(sam, [routine('b', 'evening')]), group(ava, [routine('c', 'evening')]), group(ben, [routine('d', 'evening')])];
    expect(shown(upNext(four, NONE, 'evening'))).toEqual([['cory', 'a'], ['sam', 'b'], ['ava', 'c']]);
    // Someone with nothing left does not use up one of the three.
    expect(shown(upNext(four, new Set(['a']), 'evening'))).toEqual([['sam', 'b'], ['ava', 'c'], ['ben', 'd']]);
  });

  it("counts today's Routines not ticked and not shown", () => {
    // Left and not shown: Sam's plants, Ava's read.
    expect(upNext(drawing, drawingDone, 'evening').more).toBe(2);
    // A fourth person's Routines are not shown either.
    const four = [group(cory, [routine('a', 'evening')]), group(sam, [routine('b', 'evening')]), group(ava, [routine('c', 'evening')]), group(ben, [routine('d', 'evening'), routine('e', null, 1)])];
    expect(upNext(four, NONE, 'evening').more).toBe(2);
  });

  it('counts Routines of later parts, which have no tile yet', () => {
    const rows = [group(sam, [routine('m', 'morning'), routine('e1', 'evening', 1), routine('e2', 'evening', 2)])];
    const result = upNext(rows, new Set(['m']), 'afternoon');
    expect(result.tiles).toEqual([]);
    expect(result.more).toBe(2);
  });

  it("shows the first Routine not ticked among the part's own, then what is left from earlier, then Any time", () => {
    const rows = [group(sam, [routine('any', null, 0), routine('early', 'morning', 1), routine('own2', 'afternoon', 3), routine('own1', 'afternoon', 2)])];
    expect(shown(upNext(rows, NONE, 'afternoon'))).toEqual([['sam', 'own1']]);
    expect(shown(upNext(rows, new Set(['own1']), 'afternoon'))).toEqual([['sam', 'own2']]);
    expect(shown(upNext(rows, new Set(['own1', 'own2']), 'afternoon'))).toEqual([['sam', 'early']]);
    expect(shown(upNext(rows, new Set(['own1', 'own2', 'early']), 'afternoon'))).toEqual([['sam', 'any']]);
    expect(upNext(rows, new Set(['own1', 'own2', 'early', 'any']), 'afternoon').tiles).toEqual([]);
  });

  it("puts the part's own Routine before Any time, and shows Any time when the part has nothing of its own", () => {
    const rows = [group(sam, [routine('any', null, 0), routine('e', 'evening', 1)])];
    expect(shown(upNext(rows, NONE, 'morning'))).toEqual([['sam', 'any']]);
    expect(shown(upNext(rows, NONE, 'evening'))).toEqual([['sam', 'e']]);
  });

  it('says nothing is left, with nothing to count, when everyone has ticked everything', () => {
    const everything = new Set(['bins', 'bed', 'stretch', 'plants', 'teeth', 'dog', 'read', 'toys', 'brush']);
    expect(upNext(drawing, everything, 'evening')).toEqual({ tiles: [], more: 0 });
    expect(upNext([], NONE, 'evening')).toEqual({ tiles: [], more: 0 });
  });

  it('does not count a completion that is not one of the Routines it is given', () => {
    expect(upNext([group(sam, [routine('a', 'evening')])], new Set(['elsewhere']), 'evening').tiles).toHaveLength(1);
  });
});

describe("the link in Up next's heading", () => {
  it('reads "All routines" when the tiles show everything left', () => {
    expect(upNextLink(0)).toEqual({ words: 'All routines', name: 'All routines' });
  });

  it('reads how many more there are when the tiles do not show them all, and is still named for where it goes', () => {
    expect(upNextLink(5)).toEqual({ words: '5 more', name: '5 more. All routines' });
    expect(upNextLink(1)).toEqual({ words: '1 more', name: '1 more. All routines' });
  });

  it('shows the visible words inside its name, so what a person reads is what a screen reader says', () => {
    for (const more of [0, 1, 2, 17]) {
      const { words, name } = upNextLink(more);
      expect(name.startsWith(words), String(more)).toBe(true);
    }
  });
});

// ---- A tick that did not save --------------------------------------------------------------------------

describe('a tick that did not save', () => {
  it('says "No internet, so that did not save. Try again soon." when the screen is offline, and "That did not save. Try again." otherwise', () => {
    expect(TICK_OFFLINE).toBe('No internet, so that did not save. Try again soon.');
    expect(TICK_FAILED).toBe('That did not save. Try again.');
    expect(afterTick({}, 'ava', false, true)).toEqual({ ava: TICK_OFFLINE });
    expect(afterTick({}, 'ava', false, false)).toEqual({ ava: TICK_FAILED });
  });

  it('belongs to the person whose tick it was, and to no one else', () => {
    const problems = afterTick({}, 'ava', false, false);
    expect(problems['ben']).toBeUndefined();
    expect(afterTick(problems, 'ben', false, true)).toEqual({ ava: TICK_FAILED, ben: TICK_OFFLINE });
  });

  it("goes at that person's next tick that saves", () => {
    const problems = { ava: TICK_FAILED, ben: TICK_OFFLINE };
    expect(afterTick(problems, 'ava', true, false)).toEqual({ ben: TICK_OFFLINE });
  });

  it("is not taken away by another person's tick that saves", () => {
    const problems = { ava: TICK_FAILED };
    expect(afterTick(problems, 'ben', true, false)).toBe(problems);
  });

  it('is said again, in the right words, by a later tick that does not save either', () => {
    const first = afterTick({}, 'ava', false, true);
    expect(afterTick(first, 'ava', false, false)).toEqual({ ava: TICK_FAILED });
    expect(afterTick(afterTick({}, 'ava', false, false), 'ava', false, true)).toEqual({ ava: TICK_OFFLINE });
  });

  it('is left alone, as the same object, by a tick that saves when there was nothing to say', () => {
    const problems = {};
    expect(afterTick(problems, 'ava', true, true)).toBe(problems);
  });

  it('never changes what it is given', () => {
    const problems = Object.freeze({ ava: TICK_FAILED });
    expect(() => afterTick(problems, 'ava', true, false)).not.toThrow();
    expect(() => afterTick(problems, 'ben', false, true)).not.toThrow();
    expect(problems).toEqual({ ava: TICK_FAILED });
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
    const markup = renderToStaticMarkup(createElement(PictureField, { about: "Ava's new Routine", picture, onChange: () => undefined }));
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
