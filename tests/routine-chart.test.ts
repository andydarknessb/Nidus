import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROFILE_PALETTE, createProfile, type Profile } from '../src/lib/profiles';
import {
  CHART_CHOICES,
  HOME_HOLD_MS,
  holdEndsAt,
  routineChart,
  seePart,
  startChart,
  tickedRead,
  type ChartPart,
  type ChartRead,
  type ChartState,
  type Frame,
  type Measured,
  type RoutineChart,
  type TickedHere,
} from '../src/lib/routine-chart';
import { completeRoutine, createRoutine, loadCompletions, loadRoutines, maskOf, uncompleteRoutine, type Routine, type TimeOfDay } from '../src/lib/routines';
import { startSyncedRead } from '../src/lib/synced-read';
import { householdDay, instantAt } from '@shared/zoned-time.ts';
import { THURSDAY, chartOf, scene, type SceneOptions } from './support/routine-chart';
import { asDevice, asHouseholdAccount, asServiceRole, createHousehold, destroyHousehold, destroyTablet, type HouseholdAccount, type Tablet } from './support/supabase';

// The Routine Chart (CONTEXT.md; src/lib/routine-chart.ts) through its interface: the facts it is told (what the read holds, the clock, the
// Profiles), the state it keeps, and what it answers every screen with: the columns and what is in them, the person the phone shows, a
// tap, and Up next. A screen draws what it is given, so what a person sees of the Routines is decided and tested here.
// tests/support/routine-chart.ts acts on the read the way the synced read does; the last describe drives the real read as a Device.

const CHICAGO = 'America/Chicago';
const NONE: readonly string[] = [];

function profile(id: string, sort = 0, name = id): Profile {
  return { id, name, color: '#93c5fd', avatar_url: null, sort_order: sort };
}

// A Routine of the Profile `who` (its id), scheduled every day unless said.
function routine(id: string, who: string, timeOfDay: TimeOfDay | null = null, sortOrder = 0, overrides: Partial<Routine> = {}): Routine {
  return { id, profile_id: who, title: id, days_of_week: 127, time_of_day: timeOfDay, picture: null, sort_order: sortOrder, archived_at: null, ...overrides };
}

const ids = (rows: Routine[]) => rows.map((row) => row.id);

// A button and a frame as the page measures them: the button `height` tall with its top at `top`, and a frame whose top is `top` with a
// border `clientTop` thick. `at(n)` is a button whose middle is n px down a frame at the top of the page.
const button = (top: number, height = 80): Measured => ({ getBoundingClientRect: () => ({ top, height }) });
const frame = (top: number, clientTop = 0): Frame => ({ getBoundingClientRect: () => ({ top, height: 600 }), clientTop });
const at = (n: number) => ({ button: button(n - 20, 40), frame: frame(0) });
const press = at(40);

// The people with a burst playing over their column.
const playing = (chart: RoutineChart) => chart.columns.filter((column) => column.burst !== undefined).map((column) => column.profile.id);

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
};

// One Profile 'p1' with `rows` and `done` ticked, the chart showing `part`, as the chart first draws it.
const P1 = profile('p1');
function solo(rows: Routine[], done: Iterable<string>, part: ChartPart, held: Iterable<string> = []) {
  const s = scene({ profiles: [P1], routines: rows, done });
  s.show(part, held);
  return s;
}
const column = (rows: Routine[], done: Iterable<string>, part: ChartPart, held: Iterable<string> = []) => solo(rows, done, part, held).chart().columnFor('p1')!;

// ---- Which part of the day it is ----------------------------------------------------------------------

describe('the part of the day a screen has seen', () => {
  const when = (date: string, time: string, timezone = CHICAGO) => new Date(instantAt(date, time, timezone));

  it('says which part it is, and in which zone', () => {
    expect(seePart(null, CHICAGO, when('2026-10-02', '08:00'))).toEqual({ timezone: CHICAGO, part: 'morning' });
    expect(seePart(null, 'Pacific/Auckland', when('2026-10-02', '19:00', 'Pacific/Auckland'))).toEqual({ timezone: 'Pacific/Auckland', part: 'evening' });
  });

  it('is the same object, minute after minute, while the part has not changed', () => {
    const first = seePart(null, CHICAGO, when('2026-10-02', '12:00'));
    for (const time of ['12:01', '13:30', '16:58', '16:59']) expect(seePart(first, CHICAGO, when('2026-10-02', time)), time).toBe(first);
  });

  it('is a new object when a part begins, and the same again after it', () => {
    const afternoon = seePart(null, CHICAGO, when('2026-10-02', '16:59'));
    const evening = seePart(afternoon, CHICAGO, when('2026-10-02', '17:00'));
    expect(evening).not.toBe(afternoon);
    expect(evening.part).toBe('evening');
    expect(seePart(evening, CHICAGO, when('2026-10-02', '17:01'))).toBe(evening);
    // Midnight begins the morning.
    expect(seePart(evening, CHICAGO, when('2026-10-03', '00:00')).part).toBe('morning');
  });

  it('is a new object for another zone, even when the part is the same', () => {
    const chicago = seePart(null, CHICAGO, when('2026-10-02', '10:00'));
    const other = seePart(chicago, 'America/New_York', when('2026-10-02', '10:00', 'America/New_York'));
    expect(other).not.toBe(chicago);
    expect(other).toEqual({ timezone: 'America/New_York', part: 'morning' });
  });

  it('never changes the object it is given', () => {
    const was = Object.freeze({ timezone: CHICAGO, part: 'morning' as const });
    expect(() => seePart(was, CHICAGO, when('2026-10-02', '17:30'))).not.toThrow();
    expect(was).toEqual({ timezone: CHICAGO, part: 'morning' });
  });
});

// ---- A column for every Profile that has a Routine on any day ----------------------------------------------

describe('the columns', () => {
  const sam = profile('sam', 1, 'Sam');
  const cory = profile('cory', 0, 'Cory');
  const ava = profile('ava', 2, 'Ava');
  const ben = profile('ben', 3, 'Ben');
  const MON = 1;
  const SAT = 6;
  const MONDAY = '2026-10-05';
  const columnsOf = (profiles: Profile[], rows: Routine[], weekday: number) => chartOf({ profiles, routines: rows, weekday }).columns.map((each) => [each.profile.id, ids(each.routines.all)] as const);

  it('has a column for every Profile with a Routine on any day, in Profile order', () => {
    const rows = [routine('a', 'ava'), routine('s', 'sam')];
    expect(columnsOf([ava, sam, cory, ben], rows, MON).map(([who]) => who)).toEqual(['sam', 'ava']);
  });

  it('holds the Routines scheduled today, in order, and none for a Profile whose Routines are on other days', () => {
    const rows = [
      routine('s-mon', 'sam', null, 1, { days_of_week: maskOf([MON]) }),
      routine('s-daily', 'sam', null, 0),
      routine('a-sat', 'ava', null, 0, { days_of_week: maskOf([SAT]) }),
    ];
    expect(columnsOf([cory, sam, ava], rows, MON)).toEqual([
      ['sam', ['s-daily', 's-mon']],
      ['ava', []],
    ]);
    // The same Profiles on Saturday: the columns do not move, only what is in them.
    expect(columnsOf([cory, sam, ava], rows, SAT)).toEqual([
      ['sam', ['s-daily']],
      ['ava', ['a-sat']],
    ]);
  });

  it('leaves out a Profile with no Routines at all, and one whose Routines are all archived', () => {
    const rows = [routine('old', 'ben', null, 0, { archived_at: '2026-09-01T00:00:00Z' }), routine('a', 'ava')];
    expect(columnsOf([cory, ava, ben], rows, MON).map(([who]) => who)).toEqual(['ava']);
    expect(columnsOf([cory, ava, ben], [], MON)).toEqual([]);
  });

  it('does not show an archived Routine in a column that is there for another', () => {
    const rows = [routine('old', 'ava', null, 0, { archived_at: '2026-09-01T00:00:00Z' }), routine('a', 'ava', null, 1)];
    expect(columnsOf([ava], rows, MON)).toEqual([['ava', ['a']]]);
  });

  it('ignores Routines of a Profile that is not in the list', () => {
    expect(columnsOf([cory], [routine('x', 'stranger')], MON)).toEqual([]);
  });

  it('keeps only the Routines scheduled for the weekday, in order, never archived ones', () => {
    const daily = routine('daily', 'p1', null, 2);
    const weekdays = routine('weekdays', 'p1', null, 0, { days_of_week: maskOf([1, 2, 3, 4, 5]) });
    const weekend = routine('weekend', 'p1', null, 1, { days_of_week: maskOf([SAT, 0]) });
    const archived = routine('archived', 'p1', null, 3, { archived_at: '2026-09-01T00:00:00Z' });
    const all = [daily, weekdays, weekend, archived];
    expect(columnsOf([P1], all, MON)).toEqual([['p1', ['weekdays', 'daily']]]);
    expect(columnsOf([P1], all, SAT)).toEqual([['p1', ['weekend', 'daily']]]);
    expect(columnsOf([P1], all, 0)).toEqual([['p1', ['weekend', 'daily']]]);
  });

  it('follows the Household date across a timezone boundary', () => {
    // Saturday 23:30 in Chicago is already Sunday 04:30 UTC: the weekend Routine shows in both, the weekday one in neither.
    const instant = new Date('2026-09-27T04:30:00Z'); // Sunday in UTC, Saturday in Chicago
    expect(householdDay('UTC', instant).weekday).toBe(0);
    expect(householdDay(CHICAGO, instant).weekday).toBe(SAT);
    const all = [routine('weekdays', 'p1', null, 0, { days_of_week: maskOf([1, 2, 3, 4, 5]) }), routine('weekend', 'p1', null, 1, { days_of_week: maskOf([SAT, 0]) }), routine('daily', 'p1', null, 2)];
    const friday = new Date('2026-10-03T04:30:00Z'); // Saturday in UTC, Friday in Chicago
    expect(columnsOf([P1], all, householdDay('UTC', friday).weekday)).toEqual([['p1', ['weekend', 'daily']]]);
    expect(columnsOf([P1], all, householdDay(CHICAGO, friday).weekday)).toEqual([['p1', ['weekdays', 'daily']]]);
  });

  it("groups under each Profile in the Profile's order, a Profile with nothing today keeping an empty column, and one with no Routines at all left out", () => {
    const profiles = [profile('p1', 0, 'Mom'), profile('p2', 1, 'Sam'), profile('p3', 2, 'Dad')];
    const rows = [routine('a', 'p2', null, 1), routine('b', 'p2', null, 0), routine('c', 'p1', null, 0, { days_of_week: maskOf([SAT]) })];
    // Mom's Routine is on Saturdays, so Monday leaves her column empty: it is there, with nothing in it, and Dad has none at all.
    expect(columnsOf(profiles, rows, MON)).toEqual([
      ['p1', []],
      ['p2', ['b', 'a']],
    ]);
  });

  it('answers columnFor with the column of a Profile, and nothing for one the chart has no column for', () => {
    const chart = chartOf({ profiles: [ava, ben], routines: [routine('a', 'ava')], date: MONDAY });
    expect(chart.columnFor('ava')).toBe(chart.columns[0]);
    expect(chart.columnFor('ben')).toBeUndefined();
  });

  it('is empty until both the Routines and the Profiles are read', () => {
    expect(chartOf({ profiles: [ava], routines: [routine('a', 'ava')], unread: true }).columns).toEqual([]);
    expect(chartOf({ profiles: null, routines: [routine('a', 'ava')] }).columns).toEqual([]);
  });
});

// ---- How far a Profile is -------------------------------------------------------------------------------

describe("progress through a Profile's Routines today", () => {
  const progress = (rows: Routine[], done: string[], weekday = 4) => chartOf({ profiles: [P1], routines: rows, done, weekday }).columnFor('p1')!.progress;

  it("counts only today's Routines: not an archived one, not one for another weekday, and not a completion of either", () => {
    const daily = routine('daily', 'p1', null, 0);
    const weekdays = routine('weekdays', 'p1', null, 1, { days_of_week: maskOf([1, 2, 3, 4, 5]) });
    const weekend = routine('weekend', 'p1', null, 2, { days_of_week: maskOf([6, 0]) });
    const archived = routine('archived', 'p1', null, 3, { archived_at: '2026-09-01T00:00:00Z' });
    const all = [daily, weekdays, weekend, archived];
    // Every one of them has a completion today, as a read of the day's completions would find.
    const everything = all.map((r) => r.id);

    expect(progress(all, everything, 1)).toEqual({ done: 2, total: 2 });
    expect(progress(all, ['weekend'], 6)).toEqual({ done: 1, total: 2 });
    expect(progress(all, ['weekdays', 'archived'], 6)).toEqual({ done: 0, total: 2 });
  });

  it('is worked out for each Profile on its own', () => {
    const profiles = [profile('p1', 0, 'Mom'), profile('p2', 1, 'Sam')];
    const rows = [routine('a', 'p1'), routine('b', 'p2'), routine('c', 'p2', null, 1)];
    const chart = chartOf({ profiles, routines: rows, done: ['a', 'b'] });
    expect(chart.columns.map((each) => each.progress)).toEqual([
      { done: 1, total: 1 },
      { done: 1, total: 2 },
    ]);
  });
});

// ---- What a part shows ----------------------------------------------------------------------------------

describe('what a part shows', () => {
  // Ava's day in the drawings: three Routines done before the evening, one for the evening and one for any time.
  const ava = [routine('teeth', 'p1', 'morning', 0), routine('dressed', 'p1', 'morning', 1), routine('homework', 'p1', 'afternoon', 2), routine('dog', 'p1', 'evening', 3), routine('read', 'p1', null, 4)];
  const afternoonDone = ['teeth', 'dressed', 'homework'];

  it("shows the part's own Routines, then what is left from earlier, then Any time", () => {
    const view = column([routine('dog', 'p1', 'evening'), routine('later', 'p1', 'evening', 1), routine('any', 'p1', null, 2), routine('left', 'p1', 'morning', 3)], NONE, 'evening').routines;
    expect(ids(view.own)).toEqual(['dog', 'later']);
    expect(ids(view.earlier)).toEqual(['left']);
    expect(ids(view.anytime)).toEqual(['any']);
    expect(view.doneEarlier).toBe(0);
    expect(ids(view.visible)).toEqual(['dog', 'later', 'left', 'any']);
  });

  it('is the drawing for the evening: its own, Any time, and the three done earlier counted in the foot line', () => {
    const view = column(ava, afternoonDone, 'evening').routines;
    expect(ids(view.own)).toEqual(['dog']);
    expect(ids(view.earlier)).toEqual([]);
    expect(ids(view.anytime)).toEqual(['read']);
    expect(view.doneEarlier).toBe(3);
  });

  it("keeps each group in its Routines' own order, whatever order they arrive in", () => {
    const rows = [routine('b', 'p1', 'evening', 5), routine('a', 'p1', 'evening', 1), routine('y', 'p1', null, 9), routine('x', 'p1', null, 2)];
    const view = column(rows, NONE, 'evening').routines;
    expect(ids(view.own)).toEqual(['a', 'b']);
    expect(ids(view.anytime)).toEqual(['x', 'y']);
    // The list it was given is left as it was.
    expect(ids(rows)).toEqual(['b', 'a', 'y', 'x']);
  });

  it('shows its own Routines whether they are ticked or not', () => {
    const view = column([routine('a', 'p1', 'afternoon'), routine('b', 'p1', 'afternoon', 1)], ['a'], 'afternoon').routines;
    expect(ids(view.own)).toEqual(['a', 'b']);
  });

  it('shows Any time Routines in every part, ticked or not, and never counts them in the foot line', () => {
    const rows = [routine('any', 'p1')];
    for (const part of ['morning', 'afternoon', 'evening'] as const) {
      expect(ids(column(rows, NONE, part).routines.anytime), part).toEqual(['any']);
      expect(ids(column(rows, ['any'], part).routines.anytime), part).toEqual(['any']);
      expect(column(rows, ['any'], part).routines.doneEarlier, part).toBe(0);
    }
  });

  it('never shows a Routine of a later part, and never counts it', () => {
    const rows = [routine('m', 'p1', 'morning'), routine('a', 'p1', 'afternoon', 1), routine('e', 'p1', 'evening', 2)];
    const morning = column(rows, ['e', 'a'], 'morning').routines;
    expect(ids(morning.own)).toEqual(['m']);
    expect(morning.earlier).toEqual([]);
    expect(morning.doneEarlier).toBe(0);
    const afternoon = column(rows, ['e'], 'afternoon').routines;
    expect(ids(afternoon.own)).toEqual(['a']);
    expect(afternoon.doneEarlier).toBe(0);
  });

  it('has nothing left from earlier in the morning, which begins at midnight', () => {
    const view = column(ava, NONE, 'morning').routines;
    expect(ids(view.own)).toEqual(['teeth', 'dressed']);
    expect(view.earlier).toEqual([]);
    expect(view.doneEarlier).toBe(0);
  });

  it('shows every Routine of the day on the whole day, with nothing left from earlier', () => {
    const view = column(ava, afternoonDone, 'whole').routines;
    expect(ids(view.all)).toEqual(['teeth', 'dressed', 'homework', 'dog', 'read']);
    expect(ids(view.visible)).toEqual(ids(view.all));
    expect([view.own, view.earlier, view.anytime]).toEqual([[], [], []]);
    expect(view.doneEarlier).toBe(0);
  });
});

describe('left from earlier', () => {
  const rows = [routine('m1', 'p1', 'morning', 0), routine('m2', 'p1', 'morning', 1), routine('a1', 'p1', 'afternoon', 2), routine('e1', 'p1', 'evening', 3)];
  const earlier = (done: string[], part: TimeOfDay) => column(rows, done, part).routines;

  it("is every Routine of an earlier part that is not ticked, the morning's first and each part in its own order", () => {
    expect(ids(earlier([], 'evening').earlier)).toEqual(['m1', 'm2', 'a1']);
    expect(ids(earlier(['m2'], 'evening').earlier)).toEqual(['m1', 'a1']);
    expect(ids(earlier([], 'afternoon').earlier)).toEqual(['m1', 'm2']);
  });

  it('counts the earlier Routines that are ticked and not shown, for the foot line', () => {
    const view = earlier(['m1', 'a1'], 'evening');
    expect(ids(view.earlier)).toEqual(['m2']);
    expect(view.doneEarlier).toBe(2);
    expect(earlier(['m1', 'm2', 'a1'], 'evening').doneEarlier).toBe(3);
  });

  it('brings a Routine back when it is unticked', () => {
    expect(ids(earlier(['m1'], 'afternoon').earlier)).toEqual(['m2']);
    expect(ids(earlier([], 'afternoon').earlier)).toEqual(['m1', 'm2']);
  });
});

describe('a Routine ticked while it is shown', () => {
  const rows = [routine('m1', 'p1', 'morning', 0), routine('m2', 'p1', 'morning', 1), routine('e1', 'p1', 'evening', 2)];

  it('stays where it is, done, once it is held', () => {
    const view = column(rows, ['m1'], 'evening', ['m1']).routines;
    expect(ids(view.earlier)).toEqual(['m1', 'm2']);
    // It is shown, so it is not counted among the Routines done and not shown.
    expect(view.doneEarlier).toBe(0);
  });

  it('is counted in the foot line instead when it was never held, as one ticked before the part began', () => {
    const view = column(rows, ['m1'], 'evening', NONE).routines;
    expect(ids(view.earlier)).toEqual(['m2']);
    expect(view.doneEarlier).toBe(1);
  });

  it('is held once the chart has shown it unticked, until the part changes', () => {
    const s = solo(rows, NONE, 'evening');
    // The chart is drawn: m1 and m2 are shown, not ticked.
    s.chart();
    // A child ticks m1: it stays, done.
    s.done.add('m1');
    const ticked = s.chart().columnFor('p1')!;
    expect(ids(ticked.routines.earlier)).toEqual(['m1', 'm2']);
    expect(ticked.routines.doneEarlier).toBe(0);
    // The part changes (here by hand, to the afternoon and back): it is let go, and counted in the foot line.
    ticked.pickPart('afternoon');
    s.chart().pickPart('evening');
    const again = s.chart().columnFor('p1')!;
    expect(ids(again.routines.earlier)).toEqual(['m2']);
    expect(again.routines.doneEarlier).toBe(1);
  });

  it('ignores a held Routine that is not from an earlier part: its own and Any time Routines show anyway', () => {
    const view = column(rows, NONE, 'evening', ['e1', 'nobody']).routines;
    expect(ids(view.own)).toEqual(['e1']);
    expect(ids(view.earlier)).toEqual(['m1', 'm2']);
  });

  it('keeps nothing in place before the day\'s ticks have been read: what is shown then is not what is left', () => {
    const s = solo(rows, NONE, 'evening');
    s.facts = { ...s.facts, read: { ...s.facts.read!, date: '2026-09-30' } };
    s.chart();
    expect(s.state.chart.held.size).toBe(0);
  });
});

describe('a part being done', () => {
  const rows = [routine('m', 'p1', 'morning', 0), routine('e1', 'p1', 'evening', 1), routine('e2', 'p1', 'evening', 2), routine('any', 'p1', null, 3)];

  it('says so when everything shown for it is ticked: its own, what is left from earlier, and Any time', () => {
    expect(column(rows, ['m', 'e1', 'e2', 'any'], 'evening').partDone).toBe(true);
    // Left from earlier and Any time count: a Routine of either that is not ticked keeps the evening open.
    expect(column(rows, ['e1', 'e2', 'any'], 'evening').partDone).toBe(false);
    expect(column(rows, ['m', 'e1', 'e2'], 'evening').partDone).toBe(false);
  });

  it('does not say so while one of its own is left', () => {
    expect(column(rows, ['m', 'e1', 'any'], 'evening').partDone).toBe(false);
  });

  it('counts a held Routine, ticked, among what is shown and ticked', () => {
    const view = column(rows, ['m', 'e1', 'e2', 'any'], 'evening', ['m']);
    expect(ids(view.routines.earlier)).toEqual(['m']);
    expect(view.partDone).toBe(true);
  });

  it('is never said of a part that shows nothing', () => {
    const view = column([routine('e', 'p1', 'evening')], ['e'], 'morning');
    expect(view.routines.own).toEqual([]);
    expect(view.partDone).toBe(false);
    // A person with nothing today has a column with nothing in it.
    expect(column([routine('e', 'p1', 'evening', 0, { days_of_week: 0 })], NONE, 'evening').partDone).toBe(false);
  });

  it('is not about the Routines of later parts, which it does not show', () => {
    expect(column(rows, ['m'], 'morning').partDone).toBe(false); // the Any time one is shown, and left
    expect(column(rows, ['m', 'any'], 'morning').partDone).toBe(true);
  });
});

// ---- Finished -------------------------------------------------------------------------------------------

describe('the Profiles that are all done', () => {
  const mom = profile('p1', 0, 'Mom');
  const sam = profile('p2', 1, 'Sam');
  const rows = [routine('a', 'p1'), routine('b', 'p1', null, 1), routine('c', 'p2')];
  const finished = (done: string[], list = rows, who = [mom, sam]) =>
    chartOf({ profiles: who, routines: list, done })
      .columns.filter((each) => each.finished)
      .map((each) => each.profile.id);

  it('are the ones with every Routine today ticked', () => {
    expect(finished(['a', 'b'])).toEqual(['p1']);
    expect(finished(['c'])).toEqual(['p2']);
    expect(finished(['a', 'b', 'c'])).toEqual(['p1', 'p2']);
  });

  it('are none while every Profile has one left, or nothing is ticked', () => {
    expect(finished([])).toEqual([]);
    expect(finished(['a'])).toEqual([]);
  });

  it('never include a Profile with no Routines today, or count a completion that is not its own', () => {
    expect(finished(['a'], [])).toEqual([]);
    expect(finished(['a'], [routine('a', 'p1', null, 0, { days_of_week: 0 })])).toEqual([]);
    expect(finished(['a', 'c', 'elsewhere'])).toEqual(['p2']);
  });
});

// ---- The chart opens on the part it is now and follows it ----------------------------------------------

describe('the chart opens on the part it is now and follows it', () => {
  const rows = [routine('m1', 'p1', 'morning', 0), routine('e1', 'p1', 'evening', 1)];
  const at = (clock: TimeOfDay) => scene({ profiles: [P1], routines: rows, clock });

  it('lists the parts in the order the day happens, then the whole day', () => {
    expect(CHART_CHOICES.map((choice) => choice.part)).toEqual(['morning', 'afternoon', 'evening', 'whole']);
  });

  it('opens on the part of the day it is in, holding nothing', () => {
    for (const part of ['morning', 'afternoon', 'evening'] as const) {
      const chart = scene({ profiles: [], routines: [], clock: part }).chart();
      expect(chart.part).toBe(part);
      expect(chart.kept.chart).toEqual({ part, clock: part, held: new Set() });
      expect(startChart(part).chart).toEqual({ part, clock: part, held: new Set() });
    }
  });

  it('moves to a new part when that part begins', () => {
    const s = at('afternoon');
    expect(s.chart().part).toBe('afternoon');
    s.facts = { ...s.facts, clock: 'evening' };
    const next = s.chart();
    expect(next.part).toBe('evening');
    expect(s.state.chart.clock).toBe('evening');
  });

  it('is left as it is while the clock stays in the part it was in', () => {
    const s = at('morning');
    const kept = s.chart().kept;
    expect(s.chart().kept).toBe(kept);
    s.chart().pickPart('evening');
    const picked = s.chart().kept;
    expect(s.chart().kept).toBe(picked);
    expect(s.chart().part).toBe('evening');
  });

  it('holds a part picked by hand until a new part begins, then follows the clock', () => {
    const s = at('evening');
    s.chart().pickPart('morning');
    expect(s.chart().part).toBe('morning');
    // The clock goes on in the same part: the pick holds.
    s.facts = { ...s.facts, clock: 'evening' };
    expect(s.chart().part).toBe('morning');
    // Midnight: a new part begins, and the chart goes with it.
    s.facts = { ...s.facts, clock: 'morning' };
    expect(s.chart().part).toBe('morning');
    const picked = at('afternoon');
    picked.chart().pickPart('evening');
    picked.facts = { ...picked.facts, clock: 'evening' };
    expect(picked.chart().kept.chart).toMatchObject({ part: 'evening', clock: 'evening' });
  });

  it('holds Whole day, picked by hand, until a new part begins', () => {
    const s = at('evening');
    s.chart().pickPart('whole');
    expect(s.chart().part).toBe('whole');
    s.facts = { ...s.facts, clock: 'evening' };
    expect(s.chart().part).toBe('whole');
    s.facts = { ...s.facts, clock: 'morning' };
    expect(s.chart().part).toBe('morning');
  });

  it('answers the part and the way to move it for every column, and for the control over them', () => {
    const chart = solo(rows, NONE, 'afternoon').chart();
    expect(chart.part).toBe('afternoon');
    expect(chart.columns[0]!.part).toBe('afternoon');
    chart.columns[0]!.pickPart('whole');
    expect(solo(rows, NONE, 'afternoon').chart().part).toBe('afternoon');
  });

  it('lets go of what it held when it moves to another part, by hand or by the clock', () => {
    const s = solo(rows, NONE, 'evening', ['a', 'b']);
    expect([...s.state.chart.held]).toEqual(['a', 'b']);
    s.chart().pickPart('afternoon');
    expect(s.state.chart.held.size).toBe(0);
    const clocked = solo(rows, NONE, 'evening', ['a', 'b']);
    clocked.facts = { ...clocked.facts, clock: 'morning' };
    clocked.chart();
    expect(clocked.state.chart.held.size).toBe(0);
    // Picking the part it is already on changes nothing.
    const held = solo(rows, NONE, 'evening', ['a', 'b']);
    held.chart();
    const before = held.state.chart;
    held.chart().pickPart('evening');
    expect(held.state.chart).toBe(before);
  });

  it('keeps what it holds, and the same chart, when nothing new is shown', () => {
    const s = solo(rows, NONE, 'evening');
    s.chart();
    expect([...s.state.chart.held]).toEqual(['m1']);
    const held = s.state.chart;
    s.chart();
    expect(s.state.chart).toBe(held);
    // A Routine newly shown is held with it.
    s.facts = { ...s.facts, read: { ...s.facts.read!, routines: [...rows, routine('m2', 'p1', 'morning', 2)] } };
    s.chart();
    expect([...s.state.chart.held]).toEqual(['m1', 'm2']);
  });

  it('never changes the state it is given', () => {
    const s = solo(rows, NONE, 'evening');
    const frozen = deepFreeze(s.state);
    expect(() => routineChart(s.facts, frozen, s.effects)).not.toThrow();
    s.facts = { ...s.facts, clock: 'morning' };
    expect(() => routineChart(s.facts, frozen, s.effects).pickPart('whole')).not.toThrow();
    expect(frozen.chart).toEqual({ part: 'evening', clock: 'evening', held: new Set() });
  });
});

// ---- Who the phone shows --------------------------------------------------------------------------------

describe('the person the phone opens on', () => {
  const picked = (people: Profile[], rows: Routine[], done: string[], part: ChartPart) => {
    const s = scene({ profiles: people, routines: rows, done });
    s.show(part);
    return s.chart().picked;
  };
  const ava = profile('ava', 0);
  const ben = profile('ben', 1);
  const cy = profile('cy', 2);

  it('is nobody when there are no people', () => {
    expect(picked([], [], NONE as string[], 'morning')).toBeNull();
  });

  it('is the first person with something left in the part shown', () => {
    const rows = [routine('a1', 'ava', 'morning'), routine('b1', 'ben', 'morning'), routine('c1', 'cy', 'morning')];
    expect(picked([ava, ben, cy], rows, ['a1'], 'morning')).toBe('ben');
    expect(picked([ava, ben, cy], rows, [], 'morning')).toBe('ava');
  });

  it('is the first person when everyone is done, or has nothing today', () => {
    expect(picked([ava, ben], [routine('a1', 'ava', 'morning'), routine('b1', 'ben', 'morning', 0, { days_of_week: 0 })], ['a1'], 'morning')).toBe('ava');
    // Neither has anything today: the first in the people strip's order, which is the Profiles' own.
    const first = profile('ben', 0);
    const second = profile('ava', 1);
    expect(picked([second, first], [routine('a1', 'ava', 'morning', 0, { days_of_week: 0 }), routine('b1', 'ben', 'morning', 0, { days_of_week: 0 })], NONE as string[], 'morning')).toBe('ben');
  });

  it('looks only at the part shown: a Routine of a later part is not left yet', () => {
    const rows = [routine('a1', 'ava', 'evening'), routine('b1', 'ben', 'morning')];
    expect(picked([ava, ben], rows, [], 'morning')).toBe('ben');
    expect(picked([ava, ben], rows, [], 'evening')).toBe('ava');
  });

  it('counts what is left from an earlier part, and Routines for any time', () => {
    const rows = [routine('a1', 'ava', 'morning'), routine('a2', 'ava', 'evening'), routine('b1', 'ben', null)];
    // Ava's evening is done, but her morning is left from earlier.
    expect(picked([ava, ben], rows, ['a2'], 'evening')).toBe('ava');
    // Ava's morning is done and her evening is not in the afternoon; Ben's any-time Routine belongs to every part.
    expect(picked([ava, ben], rows, ['a1'], 'afternoon')).toBe('ben');
  });

  it('looks at every Routine of the day on the whole day', () => {
    const rows = [routine('a1', 'ava', 'morning'), routine('b1', 'ben', 'evening')];
    expect(picked([ava, ben], rows, ['a1'], 'whole')).toBe('ben');
    expect(picked([ava, ben], rows, [], 'whole')).toBe('ava');
  });
});

describe('the person the phone keeps', () => {
  const ava = profile('ava', 0);
  const ben = profile('ben', 1);
  const rows = [routine('a1', 'ava', 'morning'), routine('b1', 'ben', 'morning')];
  const morning = (options: Partial<SceneOptions> = {}) => {
    const s = scene({ profiles: [ava, ben], routines: rows, done: [], clock: 'morning', ...options });
    return s;
  };

  it('picks by the first-pick rule once today is read, and waits before that', () => {
    const s = morning({ done: ['a1'] });
    expect(s.chart().picked).toBe('ben');
    expect(morning({ unsettled: true }).chart().picked).toBeNull();
  });

  it('is nobody when the chart has nobody', () => {
    expect(scene({ profiles: [ava], routines: [], unsettled: true, failed: true }).chart().picked).toBeNull();
    expect(scene({ profiles: [ava], routines: [] }).chart().picked).toBeNull();
  });

  it('keeps the person picked while they are on the chart', () => {
    const s = morning();
    s.chart().pick('ava');
    s.done.add('a1');
    expect(s.chart().picked).toBe('ava');
  });

  it('does not yank the card from a person who finishes mid-use', () => {
    // Ava was picked with one thing left; ticking it leaves nobody with anything in the morning, and then Ben's is ticked too.
    const s = morning();
    s.chart().pick('ava');
    s.done.add('a1');
    expect(s.chart().picked).toBe('ava');
    s.done.add('b1');
    expect(s.chart().picked).toBe('ava');
  });

  it('keeps the first person through ticks that finish them, with nobody picking', () => {
    const s = morning();
    expect(s.chart().picked).toBe('ava');
    s.done.add('a1');
    expect(s.chart().picked).toBe('ava');
  });

  it('keeps the person through a refetch, which brings the same people as new objects with new ticks', () => {
    const s = morning();
    s.chart().pick('ben');
    s.facts = { ...s.facts, profiles: [{ ...ava }, { ...ben }], read: { ...s.facts.read!, routines: rows.map((row) => ({ ...row })), done: new Set(['b1']) } };
    expect(s.chart().picked).toBe('ben');
  });

  it('keeps the person across Household midnight, when what was read is for another day and nothing is settled', () => {
    const s = morning();
    s.chart().pick('ben');
    const settled = s.facts.read!;
    s.facts = { ...s.facts, read: { ...settled, date: '2026-09-30' } };
    expect(s.chart().picked).toBe('ben');
    s.facts = { ...s.facts, read: settled };
    expect(s.chart().picked).toBe('ben');
  });

  it('picks again, by the rule, when the person leaves the chart', () => {
    const s = morning();
    s.chart().pick('ava');
    s.facts = { ...s.facts, profiles: [ben] };
    expect(s.chart().picked).toBe('ben');
    // And waits for today's ticks to be read, as the first pick does.
    const waiting = morning();
    waiting.chart().pick('ava');
    waiting.facts = { ...waiting.facts, profiles: [ben], read: { ...waiting.facts.read!, date: '2026-09-30' } };
    expect(waiting.chart().picked).toBeNull();
  });

  it('with a failed read and nothing settled picks the first person, so the tab never waits on a read that is not coming', () => {
    expect(morning({ unsettled: true, failed: true }).chart().picked).toBe('ava');
    const s = morning();
    s.chart().pick('ben');
    s.facts = { ...s.facts, failed: true, read: { ...s.facts.read!, date: '2026-09-30' } };
    expect(s.chart().picked).toBe('ben');
  });
});

describe("the chart's own words for its read", () => {
  it("is the read's own state once what was read is for today", () => {
    expect(chartOf({ profiles: [P1], routines: [], readState: 'ready' }).state).toBe('ready');
    // Ready but the last read failed: what was read stays on screen, and the header says the connection is lost.
    expect(chartOf({ profiles: [P1], routines: [], readState: 'ready', failed: true }).state).toBe('ready');
  });

  it('is loading just after Household midnight, while what was read is for yesterday', () => {
    expect(chartOf({ profiles: [P1], routines: [], unsettled: true, readState: 'ready' }).state).toBe('loading');
    expect(chartOf({ profiles: [P1], routines: [], unsettled: true, readState: 'loading' }).state).toBe('loading');
  });

  it('stays failed when nothing for today is read and the read is failing', () => {
    expect(chartOf({ profiles: [P1], routines: [], unsettled: true, readState: 'failed', failed: true }).state).toBe('failed');
    expect(chartOf({ profiles: [P1], routines: [], unsettled: true, readState: 'ready', failed: true }).state).toBe('failed');
  });

  it('is loading before anything is read, and has no day before the Household Timezone names it', () => {
    expect(chartOf({ profiles: null, routines: [], unread: true }).state).toBe('loading');
    expect(chartOf({ profiles: null, routines: [], unread: true, date: null }).date).toBeNull();
    expect(chartOf({ profiles: [P1], routines: [] }).date).toBe(THURSDAY);
  });
});

// ---- A tap ------------------------------------------------------------------------------------------------

describe('a tap on a Routine', () => {
  const ava = profile('ava', 0);
  const brush = routine('r-1', 'ava', 'morning');
  const dressed = routine('r-2', 'ava', 'morning', 1);
  const both = [brush, dressed];
  const withAva = (done: string[] = []) => scene({ profiles: [ava], routines: both, done, clock: 'morning' });

  it('ticks what is not done and takes back what is, writing the Routine Completion for the Household date', async () => {
    const s = withAva(['r-2']);
    const chart = s.chart();
    await chart.tap(brush, press);
    await chart.tap(dressed, press);
    expect(s.writes.map(({ routine: id, checking, date }) => [id, checking, date])).toEqual([
      ['r-1', true, THURSDAY],
      ['r-2', false, THURSDAY],
    ]);
  });

  it("finishes the Profile on its last tick, starting the burst at the middle of the tile, from the frame's padding edge", async () => {
    const s = withAva(['r-2']);
    // The tile's middle is 340 + 40 = 380 on the page and the frame's padding edge 100 + 4: 276 px down it.
    const pending = s.chart().tap(brush, { button: button(340), frame: frame(100, 4) });
    const burst = s.chart().columnFor('ava')!.burst;
    expect(burst).toMatchObject({ at: 276 });
    expect(await pending).toEqual({ saved: true, finished: true });
  });

  it('starts the burst before it writes, and nothing waits on the save', async () => {
    const s = withAva(['r-2']);
    await s.chart().tap(brush, { button: button(340), frame: frame(100, 4) });
    expect(s.writes).toEqual([{ routine: 'r-1', checking: true, date: THURSDAY, bursts: ['ava'] }]);
    // The write waits for the gate; the tap has already started the burst and shown the tick.
    const waiting = withAva(['r-2']);
    let open!: () => void;
    waiting.gate = new Promise<void>((resolve) => (open = resolve));
    const pending = waiting.chart().tap(brush, press);
    expect(playing(waiting.chart())).toEqual(['ava']);
    expect(waiting.chart().columnFor('ava')!.finished).toBe(true);
    open();
    await pending;
  });

  it('starts no burst for a tick that leaves something to do, or for taking a tick back', async () => {
    const some = withAva();
    expect(await some.chart().tap(brush, { button: button(340), frame: frame(100) })).toEqual({ saved: true, finished: false });
    expect(playing(some.chart())).toEqual([]);
    const back = withAva(['r-1', 'r-2']);
    expect(await back.chart().tap(brush, { button: button(340), frame: frame(100) })).toEqual({ saved: true, finished: false });
    expect(playing(back.chart())).toEqual([]);
    expect(back.writes[0]).toMatchObject({ routine: 'r-1', checking: false });
  });

  it('starts no burst before there is a frame to draw it in', async () => {
    const s = withAva(['r-2']);
    expect(await s.chart().tap(brush, { button: button(340), frame: null })).toEqual({ saved: true, finished: false });
    expect(playing(s.chart())).toEqual([]);
    expect(s.writes).toHaveLength(1);
  });

  it('starts no burst for someone who asked for less motion, and still says it finished the Profile', async () => {
    const s = withAva(['r-2']);
    s.calm = true;
    expect(await s.chart().tap(brush, press)).toEqual({ saved: true, finished: true });
    expect(playing(s.chart())).toEqual([]);
    expect(s.chart().columnFor('ava')!.finished).toBe(true);
  });

  it('holds a tick where it is for Up next, and lets go of the hold when the tick is taken back', async () => {
    const s = withAva();
    s.time = 5_000;
    await s.chart().tap(brush, press);
    expect(s.state).toMatchObject({ ticked: { 'r-1': 5_000 }, now: 5_000 });
    s.time = 6_000;
    await s.chart().tap(brush, press);
    expect(s.state.ticked).toEqual({});
    expect(s.state.now).toBe(6_000);
  });

  it('says whether it saved, and takes the tick back when it did not', async () => {
    const s = withAva();
    s.fails = true;
    const pending = s.chart().tap(brush, press);
    expect(s.chart().columnFor('ava')!.progress).toEqual({ done: 1, total: 2 });
    expect(await pending).toEqual({ saved: false, finished: false });
    expect(s.chart().columnFor('ava')!.progress).toEqual({ done: 0, total: 2 });
  });

  it('does nothing before the Household Timezone names the day', async () => {
    const s = scene({ profiles: [ava], routines: both, date: null });
    expect(await s.chart().tap(brush, press)).toEqual({ saved: false, finished: false });
    expect(s.writes).toEqual([]);
  });
});

describe('a tap that finishes a Profile', () => {
  const three = ['a', 'b', 'c'].map((id, index) => routine(id, 'p1', null, index));
  // Whether tapping `id` finishes the Profile when `done` was ticked before the tap: a tick of the last Routine left. The tap ticks what
  // was not done and takes back what was.
  const finishes = async (done: string[], id: string, rows: Routine[] = three) => {
    const s = scene({ profiles: [P1], routines: rows, done });
    return (await s.chart().tap(rows.find((row) => row.id === id) ?? routine(id, 'p1'), press)).finished;
  };

  it('is true for the tick of the last Routine left, whichever Routine that is', async () => {
    expect(await finishes(['a', 'b'], 'c')).toBe(true);
    expect(await finishes(['c', 'a'], 'b')).toBe(true);
    expect(await finishes(['b', 'c'], 'a')).toBe(true);
  });

  it('is false for a tick that leaves another Routine unticked', async () => {
    expect(await finishes([], 'a')).toBe(false);
    expect(await finishes(['a'], 'b')).toBe(false);
    expect(await finishes(['c'], 'a')).toBe(false);
  });

  it('is false for an untick, whether or not the Profile was done', async () => {
    expect(await finishes(['a', 'b', 'c'], 'c')).toBe(false);
    expect(await finishes(['a', 'b', 'c'], 'a')).toBe(false);
    expect(await finishes(['a', 'b'], 'b')).toBe(false);
    expect(await finishes(['a'], 'a')).toBe(false);
  });

  it('is true for the one tick of a Profile with one Routine', async () => {
    const only = [routine('only', 'p1')];
    expect(await finishes([], 'only', only)).toBe(true);
    expect(await finishes(['only'], 'only', only)).toBe(false);
  });

  it('is false for a Profile with no Routines today', async () => {
    const none = [routine('a', 'p1', null, 0, { days_of_week: 0 })];
    expect(await finishes([], 'a', none)).toBe(false);
    expect(await finishes(['a'], 'a', none)).toBe(false);
  });

  it("is false for the tick of a Routine that is not the Profile's, finished or not", async () => {
    expect(await finishes(['a', 'b'], 'elsewhere')).toBe(false);
    expect(await finishes(['a', 'b', 'c'], 'elsewhere')).toBe(false);
  });

  it('counts only the Routines the Profile has today, so a completion of an archived one does not finish a Profile early', async () => {
    const today = [...three, routine('old', 'p1', null, 3, { archived_at: '2026-09-01T00:00:00Z' })];
    expect(await finishes(['old', 'a'], 'b', today)).toBe(false);
    expect(await finishes(['old', 'a', 'b'], 'c', today)).toBe(true);
  });

  it('leaves the set of ticks it was given as it was, until the write changes it', async () => {
    const s = scene({ profiles: [P1], routines: three, done: ['a', 'b'] });
    s.ticks = false;
    expect((await s.chart().tap(three[2]!, press)).finished).toBe(true);
    expect([...s.done]).toEqual(['a', 'b']);
  });

  it('is true in exactly one case, over every state of three Routines and every tap: a tick of the one Routine left', async () => {
    const all = three.map((row) => row.id);
    for (let mask = 0; mask < 1 << all.length; mask += 1) {
      const done = all.filter((_, index) => (mask >> index) & 1);
      const left = all.filter((id) => !done.includes(id));
      for (const tapped of [...all, 'elsewhere']) {
        const expected = !done.includes(tapped) && left.length === 1 && left[0] === tapped;
        expect(await finishes(done, tapped), `done ${done}, tapped ${tapped}`).toBe(expected);
      }
    }
  });
});

// ---- A tick that did not save -------------------------------------------------------------------------

describe('a tick that did not save', () => {
  const D1 = THURSDAY;
  const D2 = '2026-10-02';
  const ava = profile('ava', 0);
  const ben = profile('ben', 1);
  const rows = [routine('a1', 'ava'), routine('a2', 'ava', null, 1), routine('b1', 'ben'), routine('b2', 'ben', null, 1)];
  const world = () => scene({ profiles: [ava, ben], routines: rows });
  const says = (s: ReturnType<typeof world>, who: string) => s.chart().columnFor(who)?.problem;
  // A tap of `id` that does not save, or does.
  const tap = async (s: ReturnType<typeof world>, id: string, fails: boolean, offline = false) => {
    s.fails = fails;
    s.offline = offline;
    await s.chart().tap(rows.find((row) => row.id === id)!, press);
  };

  it('says "No internet, so that did not save. Try again soon." when the screen is offline, and "That did not save. Try again." otherwise', async () => {
    const online = world();
    await tap(online, 'a1', true);
    expect(says(online, 'ava')).toBe('That did not save. Try again.');
    const offline = world();
    await tap(offline, 'a1', true, true);
    expect(says(offline, 'ava')).toBe('No internet, so that did not save. Try again soon.');
  });

  it('says nothing before a tick has failed', () => {
    expect(says(world(), 'ava')).toBeUndefined();
  });

  it('belongs to the person whose tick it was, and to no one else', async () => {
    const s = world();
    await tap(s, 'a1', true);
    expect(says(s, 'ben')).toBeUndefined();
    await tap(s, 'b1', true, true);
    expect([says(s, 'ava'), says(s, 'ben')]).toEqual(['That did not save. Try again.', 'No internet, so that did not save. Try again soon.']);
  });

  it("goes at that person's next tick that saves", async () => {
    const s = world();
    await tap(s, 'a1', true);
    await tap(s, 'b1', true, true);
    await tap(s, 'a2', false);
    expect([says(s, 'ava'), says(s, 'ben')]).toEqual([undefined, 'No internet, so that did not save. Try again soon.']);
  });

  it("is not taken away by another person's tick that saves", async () => {
    const s = world();
    await tap(s, 'a1', true);
    const problems = s.state.problems;
    await tap(s, 'b1', false);
    expect(s.state.problems).toBe(problems);
    expect(says(s, 'ava')).toBe('That did not save. Try again.');
  });

  it('is said again, in the right words, by a later tick that does not save either', async () => {
    const s = world();
    await tap(s, 'a1', true, true);
    await tap(s, 'a2', true, false);
    expect(says(s, 'ava')).toBe('That did not save. Try again.');
    await tap(s, 'a1', true, true);
    expect(says(s, 'ava')).toBe('No internet, so that did not save. Try again soon.');
  });

  it('is left alone, as the same object, by a tick that saves when there was nothing to say', async () => {
    const s = world();
    const problems = s.state.problems;
    await tap(s, 'a1', false, true);
    expect(s.state.problems).toBe(problems);
  });

  it('never changes what it is given', async () => {
    const s = world();
    await tap(s, 'a1', true);
    const frozen = deepFreeze(s.state);
    s.state = frozen;
    await tap(s, 'a2', false);
    await tap(s, 'b1', true, true);
    expect(frozen.problems).toEqual({ day: D1, says: { ava: 'That did not save. Try again.' } });
  });

  describe('and its day', () => {
    it('does not outlive it: a line said on one Household day is gone on the next', async () => {
      const s = world();
      await tap(s, 'b1', true);
      await tap(s, 'a1', true, true);
      expect([says(s, 'ava'), says(s, 'ben')]).toEqual(['No internet, so that did not save. Try again soon.', 'That did not save. Try again.']);
      s.facts = { ...s.facts, date: D2, read: { ...s.facts.read!, date: D2 } };
      expect([says(s, 'ava'), says(s, 'ben')]).toEqual([undefined, undefined]);
    });

    it('starts the next day clean: a tick that does not save then says only that, with nothing left of the day before', async () => {
      const s = world();
      await tap(s, 'a1', true, true);
      await tap(s, 'b1', true);
      s.facts = { ...s.facts, date: D2, read: { ...s.facts.read!, date: D2 } };
      await tap(s, 'b2', true);
      expect([says(s, 'ava'), says(s, 'ben')]).toEqual([undefined, 'That did not save. Try again.']);
    });

    it('is not brought back by a tick that saves on the next day', async () => {
      const s = world();
      await tap(s, 'a1', true);
      s.facts = { ...s.facts, date: D2, read: { ...s.facts.read!, date: D2 } };
      await tap(s, 'a2', false);
      await tap(s, 'b1', false);
      expect([says(s, 'ava'), says(s, 'ben')]).toEqual([undefined, undefined]);
    });

    it("keeps the day's lines while the day goes on", async () => {
      const s = world();
      await tap(s, 'a1', true);
      await tap(s, 'b1', true, true);
      expect([says(s, 'ava'), says(s, 'ben')]).toEqual(['That did not save. Try again.', 'No internet, so that did not save. Try again soon.']);
    });

    it('belongs to the day the tick was made on, even if it did not save until the next', async () => {
      // A tick begun at 23:59 on D1 that fails at 00:00:03 is said for D1, so it is never shown on D2.
      const s = world();
      let open!: () => void;
      s.gate = new Promise<void>((resolve) => (open = resolve));
      s.fails = true;
      const pending = s.chart().tap(rows[0]!, press);
      s.facts = { ...s.facts, date: D2, read: { ...s.facts.read!, date: D2 } };
      open();
      await pending;
      expect(says(s, 'ava')).toBeUndefined();
      expect(s.state.problems.day).toBe(D1);
    });
  });
});

// ---- The celebration of a finished Profile --------------------------------------------------------------

describe('the celebration of a finished Profile', () => {
  // Friday night, the first minute of Saturday, and the Monday the Profile's Routines return.
  const friday = '2026-10-02';
  const saturday = '2026-10-03';
  const monday = '2026-10-05';
  const ava = profile('ava', 0);
  const ben = profile('ben', 1);
  const a = routine('a', 'ava');
  const b = routine('b', 'ben');
  const duo = (done: string[] = []) => scene({ profiles: [ava, ben], routines: [a, b], done, date: friday, weekday: 5 });
  const burstOf = (chart: RoutineChart, who: string) => chart.columnFor(who)!.burst;
  const toDay = (s: ReturnType<typeof duo>, date: string, weekday: number) => {
    s.facts = { ...s.facts, date, weekday, read: { ...s.facts.read!, date } };
  };

  it('starts when a tap finishes a Profile, over that Profile only', async () => {
    const s = duo();
    await s.chart().tap(a, press);
    expect(playing(s.chart())).toEqual(['ava']);
    expect(playing(duo().chart())).toEqual([]);
  });

  it('plays over two Profiles at once when two finish together', async () => {
    const s = duo();
    await s.chart().tap(a, press);
    await s.chart().tap(b, press);
    expect(playing(s.chart())).toEqual(['ava', 'ben']);
  });

  it('starts where the tapped Routine is in its group, each burst at its own', async () => {
    const s = duo();
    await s.chart().tap(a, at(120));
    await s.chart().tap(b, at(15));
    const chart = s.chart();
    expect(burstOf(chart, 'ava')!.at).toBe(120);
    expect(burstOf(chart, 'ben')!.at).toBe(15);
  });

  it('starts again where the new tap was when a Profile finishes again', async () => {
    const s = duo();
    const chart = s.chart();
    await chart.tap(a, at(120));
    await chart.tap(a, at(300));
    expect(burstOf(s.chart(), 'ava')!.at).toBe(300);
  });

  it('stays where it started while the screen goes on showing the Profile finished', async () => {
    const s = duo();
    await s.chart().tap(a, at(120));
    expect(burstOf(s.chart(), 'ava')!.at).toBe(120);
    expect(burstOf(s.chart(), 'ava')!.at).toBe(120);
  });

  it('plays again when a Profile finishes again, as a new burst', async () => {
    const s = duo();
    const chart = s.chart();
    await chart.tap(a, press);
    const first = burstOf(s.chart(), 'ava')!;
    await chart.tap(a, press);
    const again = s.chart();
    expect(playing(again)).toEqual(['ava']);
    expect(burstOf(again, 'ava')!.id).not.toBe(first.id);
  });

  it('ends when its animation ends', async () => {
    const s = duo();
    await s.chart().tap(a, press);
    await s.chart().tap(b, press);
    burstOf(s.chart(), 'ava')!.land();
    expect(playing(s.chart())).toEqual(['ben']);
  });

  it('is not ended by the landing of an older burst of the same Profile', async () => {
    const s = duo();
    const chart = s.chart();
    await chart.tap(a, press);
    const first = burstOf(s.chart(), 'ava')!;
    await chart.tap(a, press);
    const second = s.chart();
    const before = s.state.celebration;
    first.land();
    expect(s.state.celebration).toBe(before);
    expect(playing(second)).toEqual(['ava']);
  });

  it('is not ended by a landing for a Profile that is not celebrating', async () => {
    const s = duo();
    await s.chart().tap(a, press);
    const burst = burstOf(s.chart(), 'ava')!;
    burst.land();
    const after = s.state.celebration;
    expect(playing(s.chart())).toEqual([]);
    // Landing again, for a Profile with no burst playing, changes nothing.
    burst.land();
    expect(s.state.celebration).toBe(after);
  });

  it('lasts while its Profile is still finished on the screen, and changes nothing', async () => {
    const s = duo();
    await s.chart().tap(a, press);
    const state = s.state.celebration;
    s.chart();
    expect(s.state.celebration).toBe(state);
    // Another Profile finishing, from another screen, changes nothing about it either.
    s.done.add('b');
    s.chart();
    expect(s.state.celebration).toBe(state);
    // And a Profile that finished with nobody tapping here has no burst at all.
    const quiet = duo(['a']);
    const none = quiet.state.celebration;
    quiet.chart();
    expect(quiet.state.celebration).toBe(none);
  });

  it('ends when the Profile is no longer finished, as with an untick, so nothing falls over "2 of 3"', async () => {
    const s = duo();
    await s.chart().tap(a, press);
    expect(playing(s.chart())).toEqual(['ava']);
    s.done.delete('a');
    expect(playing(s.chart())).toEqual([]);
  });

  it('ends when a tick is put back after a failed write, whichever tap it was', async () => {
    // Ticked, shown finished, then the write failed and the tick went back.
    const one = duo();
    one.fails = true;
    const pending = one.chart().tap(a, press);
    expect(playing(one.chart())).toEqual(['ava']);
    await pending;
    expect(playing(one.chart())).toEqual([]);
    // One Profile's tick put back while another Profile's burst plays: only the one that lost its finish ends.
    const two = duo();
    two.fails = (id) => id === 'a';
    const first = two.chart().tap(a, press);
    const second = two.chart().tap(b, press);
    expect(playing(two.chart())).toEqual(['ava', 'ben']);
    await Promise.all([first, second]);
    expect(playing(two.chart())).toEqual(['ben']);
  });

  it('is not ended by an earlier tap failing while the Profile stays finished', async () => {
    // Done already, then unticked, then ticked again (a burst). The untick's write now fails and puts its Routine back: it is ticked
    // either way, the Profile is still finished, and the burst plays on.
    const s = duo(['a']);
    s.chart();
    s.done.delete('a');
    s.chart();
    await s.chart().tap(a, press);
    const state = s.state.celebration;
    expect(playing(s.chart())).toEqual(['ava']);
    expect(s.state.celebration).toBe(state);
  });

  it("ends when its Profile's group leaves the screen, and only that Profile's", async () => {
    const s = duo();
    await s.chart().tap(a, press);
    await s.chart().tap(b, press);
    s.facts = { ...s.facts, read: { ...s.facts.read!, routines: [b] } };
    expect(playing(s.chart())).toEqual(['ben']);
  });

  it('is cleared for every Profile when the Household day changes', async () => {
    const s = duo();
    await s.chart().tap(a, press);
    await s.chart().tap(b, press);
    expect(playing(s.chart())).toEqual(['ava', 'ben']);
    // Even a Profile the new day's read shows finished does not keep a burst the old day started.
    const kept = s.state;
    toDay(s, saturday, 6);
    expect(playing(s.chart())).toEqual([]);
    s.state = kept;
    toDay(s, saturday, 6);
    s.done.clear();
    expect(playing(s.chart())).toEqual([]);
  });

  it('cannot replay when the group comes back: finished at 23:59:59 on a Friday, gone from Saturday, back on Monday', async () => {
    const fridays = routine('a', 'ava', null, 0, { days_of_week: maskOf([1, 5]) });
    const s = scene({ profiles: [ava], routines: [fridays], date: friday, weekday: 5 });
    await s.chart().tap(fridays, press);
    expect(playing(s.chart())).toEqual(['ava']);
    // Midnight: the Profile's Routines are not scheduled for Saturday, so its group leaves the screen.
    s.facts = { ...s.facts, date: saturday, weekday: 6, read: { ...s.facts.read!, date: saturday, done: new Set() } };
    expect(playing(s.chart())).toEqual([]);
    // Monday: the group comes back unfinished, and later finishes by a tick heard from another screen.
    s.facts = { ...s.facts, date: monday, weekday: 1, read: { ...s.facts.read!, date: monday } };
    expect(playing(s.chart())).toEqual([]);
    s.done.add('a');
    expect(playing(s.chart())).toEqual([]);
  });

  it('cannot replay when a group comes back on the same day either', async () => {
    const s = duo();
    await s.chart().tap(a, press);
    s.done.delete('a');
    s.chart();
    s.done.add('a');
    expect(playing(s.chart())).toEqual([]);
  });

  it('does not carry a burst from another day into a new tap', async () => {
    const s = duo();
    await s.chart().tap(a, press);
    toDay(s, saturday, 6);
    // The tap is made before the chart is drawn again for the new day, so the burst of the old one is still kept when it begins.
    await routineChart(s.facts, s.state, s.effects).tap(b, press);
    s.done.add('a');
    expect(playing(s.chart())).toEqual(['ben']);
  });

  it('works on a screen that has no day yet', () => {
    const s = scene({ profiles: [ava], routines: [a], date: null });
    const none = s.state.celebration;
    s.chart();
    expect(s.state.celebration).toBe(none);
  });

  it('never changes the state or the sets it is given', async () => {
    const s = duo();
    await s.chart().tap(a, press);
    const burst = burstOf(s.chart(), 'ava')!;
    s.state = deepFreeze(s.state);
    expect(() => s.chart().tap(b, press)).not.toThrow();
    expect(() => burst.land()).not.toThrow();
    expect(() => s.chart().pick('ava')).not.toThrow();
    toDay(s, saturday, 6);
    expect(() => s.chart()).not.toThrow();
  });

  it('belongs to a column: the phone, which asks for one, has only that person\'s, and a pick lets go of the others\'', async () => {
    const s = duo();
    s.chart().pick('ava');
    await s.chart().tap(a, press);
    await s.chart().tap(b, press);
    s.chart().pick('ben');
    expect(playing(s.chart())).toEqual(['ben']);
    // It never plays again on the way back to the person left behind.
    s.chart().pick('ava');
    expect(playing(s.chart())).toEqual([]);
  });
});

// ---- Up next -------------------------------------------------------------------------------------------------

describe('Up next', () => {
  const group = (p: Profile, rows: Routine[]) => ({ profile: p, routines: rows.map((row) => ({ ...row, profile_id: p.id })) });
  const cory = profile('cory', 0, 'Cory');
  const sam = profile('sam', 1, 'Sam');
  const ava = profile('ava', 2, 'Ava');
  const ben = profile('ben', 3, 'Ben');
  type Group = ReturnType<typeof group>;
  // Up next for these people's Routines, `done` ticked, at `part` of the day; `ticked` is what was ticked on it and `now` the time.
  const upNextOf = (groups: Group[], done: Iterable<string>, part: TimeOfDay, limit?: number, ticked: TickedHere = {}, now = 0) => {
    const s = scene({ profiles: groups.map((each) => each.profile), routines: groups.flatMap((each) => each.routines), done, clock: part });
    s.state = { ...s.state, ticked, now };
    return s.chart().upNext(limit);
  };
  const shown = (result: ReturnType<typeof upNextOf>) => result.tiles.map((tile) => [tile.profile.id, tile.routine.id]);
  const none = { tiles: [], more: 0 };
  const plain = (result: ReturnType<typeof upNextOf>) => ({ tiles: result.tiles, more: result.more });

  // The Evening drawing: Cory is done; Sam, Ava and Ben have one Routine each left in the evening and Sam and Ava one at any time.
  const drawing = [
    group(cory, [routine('bins', 'x', 'evening')]),
    group(sam, [routine('bed', 'x', 'morning'), routine('stretch', 'x', 'evening', 1), routine('plants', 'x', null, 2)]),
    group(ava, [routine('teeth', 'x', 'morning'), routine('dog', 'x', 'evening', 1), routine('read', 'x', null, 2)]),
    group(ben, [routine('toys', 'x', 'evening'), routine('brush', 'x', 'evening', 1)]),
  ];
  const drawingDone = ['bins', 'bed', 'teeth', 'brush'];

  it('is a tile for each of the first people with something left, each showing the first Routine left', () => {
    expect(shown(upNextOf(drawing, drawingDone, 'evening'))).toEqual([
      ['sam', 'stretch'],
      ['ava', 'dog'],
      ['ben', 'toys'],
    ]);
  });

  it('gives a Profile with nothing left no tile', () => {
    expect(shown(upNextOf(drawing, drawingDone, 'evening')).map(([who]) => who)).not.toContain('cory');
    expect(plain(upNextOf([group(cory, [routine('bins', 'x', 'evening')])], ['bins'], 'evening'))).toEqual(none);
  });

  it('stops at three people, the first three in Profile order who have something left', () => {
    const four = [group(cory, [routine('a', 'x', 'evening')]), group(sam, [routine('b', 'x', 'evening')]), group(ava, [routine('c', 'x', 'evening')]), group(ben, [routine('d', 'x', 'evening')])];
    expect(shown(upNextOf(four, [], 'evening'))).toEqual([['cory', 'a'], ['sam', 'b'], ['ava', 'c']]);
    // Someone with nothing left does not use up one of the three.
    expect(shown(upNextOf(four, ['a'], 'evening'))).toEqual([['sam', 'b'], ['ava', 'c'], ['ben', 'd']]);
  });

  it('stops at the limit it is given, and counts the Routines of the people left out', () => {
    const three = [group(cory, [routine('a', 'x', 'evening')]), group(sam, [routine('b', 'x', 'evening')]), group(ava, [routine('c', 'x', 'evening'), routine('d', 'x', null, 1)])];
    const result = upNextOf(three, [], 'evening', 2);
    expect(shown(result)).toEqual([['cory', 'a'], ['sam', 'b']]);
    expect(result.more).toBe(2);
  });

  it("counts today's Routines not ticked and not shown", () => {
    // Left and not shown: Sam's plants, Ava's read.
    expect(upNextOf(drawing, drawingDone, 'evening').more).toBe(2);
    // A fourth person's Routines are not shown either.
    const four = [group(cory, [routine('a', 'x', 'evening')]), group(sam, [routine('b', 'x', 'evening')]), group(ava, [routine('c', 'x', 'evening')]), group(ben, [routine('d', 'x', 'evening'), routine('e', 'x', null, 1)])];
    expect(upNextOf(four, [], 'evening').more).toBe(2);
  });

  it('counts Routines of later parts, which have no tile yet', () => {
    const rows = [group(sam, [routine('m', 'x', 'morning'), routine('e1', 'x', 'evening', 1), routine('e2', 'x', 'evening', 2)])];
    const result = upNextOf(rows, ['m'], 'afternoon');
    expect(result.tiles).toEqual([]);
    expect(result.more).toBe(2);
  });

  it("shows the first Routine not ticked among the part's own, then what is left from earlier, then Any time", () => {
    const rows = [group(sam, [routine('any', 'x', null, 0), routine('early', 'x', 'morning', 1), routine('own2', 'x', 'afternoon', 3), routine('own1', 'x', 'afternoon', 2)])];
    expect(shown(upNextOf(rows, [], 'afternoon'))).toEqual([['sam', 'own1']]);
    expect(shown(upNextOf(rows, ['own1'], 'afternoon'))).toEqual([['sam', 'own2']]);
    expect(shown(upNextOf(rows, ['own1', 'own2'], 'afternoon'))).toEqual([['sam', 'early']]);
    expect(shown(upNextOf(rows, ['own1', 'own2', 'early'], 'afternoon'))).toEqual([['sam', 'any']]);
    expect(upNextOf(rows, ['own1', 'own2', 'early', 'any'], 'afternoon').tiles).toEqual([]);
  });

  it("puts the part's own Routine before Any time, and shows Any time when the part has nothing of its own", () => {
    const rows = [group(sam, [routine('any', 'x', null, 0), routine('e', 'x', 'evening', 1)])];
    expect(shown(upNextOf(rows, [], 'morning'))).toEqual([['sam', 'any']]);
    expect(shown(upNextOf(rows, [], 'evening'))).toEqual([['sam', 'e']]);
  });

  it('says nothing is left, with nothing to count, when everyone has ticked everything', () => {
    const everything = ['bins', 'bed', 'stretch', 'plants', 'teeth', 'dog', 'read', 'toys', 'brush'];
    expect(plain(upNextOf(drawing, everything, 'evening'))).toEqual(none);
    expect(plain(upNextOf([], [], 'evening'))).toEqual(none);
  });

  it('does not count a completion that is not one of the Routines it is given', () => {
    expect(upNextOf([group(sam, [routine('a', 'x', 'evening')])], ['elsewhere'], 'evening').tiles).toHaveLength(1);
  });

  it('says whether anyone has a Routine today, and a tile\'s problem words', () => {
    expect(upNextOf(drawing, [], 'evening').scheduled).toBe(true);
    expect(upNextOf([], [], 'evening').scheduled).toBe(false);
    expect(upNextOf([group(sam, [routine('a', 'x', 'evening', 0, { days_of_week: 0 })])], [], 'evening').scheduled).toBe(false);
  });

  it('shows a tick that did not save under the tile of the person whose it was', async () => {
    const s = scene({ profiles: [sam, ava], routines: [routine('s', 'sam'), routine('a', 'ava')] });
    s.fails = true;
    await s.chart().tap(routine('s', 'sam'), press);
    const result = s.chart().upNext();
    expect(result.tiles.map((tile) => [tile.profile.id, tile.problem])).toEqual([
      ['sam', 'That did not save. Try again.'],
      ['ava', undefined],
    ]);
  });

  // A Routine ticked on Up next stays where it is, in the done look, for HOME_HOLD_MS: a double tap cannot tick the one that comes
  // next, and a second tap takes the tick back. `ticked` is what was ticked here and when; the last argument is now.
  describe('a Routine ticked on it', () => {
    const t0 = 1_000_000;
    const two = [group(sam, [routine('stretch', 'x', 'evening'), routine('plants', 'x', null, 1)])];
    const tick = (id: string, when = t0): TickedHere => ({ [id]: when });
    const tiles = (result: ReturnType<typeof upNextOf>) => result.tiles.map((tile) => [tile.profile.id, tile.routine.id, tile.done]);
    const held = (groups: Group[], done: string[], ticked: TickedHere, now: number) => upNextOf(groups, done, 'evening', undefined, ticked, now);

    it('is held for four seconds', () => {
      expect(HOME_HOLD_MS).toBe(4_000);
    });

    it('stays where it is, in the done look, for the four seconds', () => {
      for (const later of [0, 1, 1_500, HOME_HOLD_MS - 1]) {
        expect(tiles(held(two, ['stretch'], tick('stretch'), t0 + later)), `${later} ms later`).toEqual([['sam', 'stretch', true]]);
      }
    });

    it('is not counted among what is left, and what that person has next is', () => {
      expect(held(two, ['stretch'], tick('stretch'), t0 + 1).more).toBe(1);
    });

    it('gives way to what that person has next once the four seconds have passed', () => {
      expect(tiles(held(two, ['stretch'], tick('stretch'), t0 + HOME_HOLD_MS))).toEqual([['sam', 'plants', false]]);
      expect(held(two, ['stretch'], tick('stretch'), t0 + 60_000).more).toBe(0);
    });

    it("is taken back by a second tap: not ticked, it is that person's first Routine left again, even if it is still remembered", () => {
      expect(tiles(held(two, [], {}, t0 + 1_000))).toEqual([['sam', 'stretch', false]]);
      expect(tiles(held(two, [], tick('stretch'), t0 + 1_000))).toEqual([['sam', 'stretch', false]]);
    });

    it("lets a person's last Routine go once its four seconds have passed", () => {
      const only = [group(sam, [routine('stretch', 'x', 'evening')])];
      expect(tiles(held(only, ['stretch'], tick('stretch'), t0 + HOME_HOLD_MS - 1))).toEqual([['sam', 'stretch', true]]);
      expect(plain(held(only, ['stretch'], tick('stretch'), t0 + HOME_HOLD_MS))).toEqual(none);
    });

    it('keeps its place among the three, so the fourth person waits until it goes', () => {
      const four = [group(cory, [routine('a', 'x', 'evening')]), group(sam, [routine('b', 'x', 'evening')]), group(ava, [routine('c', 'x', 'evening')]), group(ben, [routine('d', 'x', 'evening')])];
      expect(tiles(held(four, ['a'], tick('a'), t0 + 1))).toEqual([['cory', 'a', true], ['sam', 'b', false], ['ava', 'c', false]]);
      expect(tiles(held(four, ['a'], tick('a'), t0 + HOME_HOLD_MS))).toEqual([['sam', 'b', false], ['ava', 'c', false], ['ben', 'd', false]]);
    });

    it('holds only what was ticked here: one ticked somewhere else gives way at once', () => {
      expect(tiles(held(two, ['stretch'], {}, t0 + 1))).toEqual([['sam', 'plants', false]]);
    });

    it('holds one for each person, each for its own four seconds', () => {
      const rows = [group(cory, [routine('a', 'x', 'evening'), routine('a2', 'x', 'evening', 1)]), group(sam, [routine('b', 'x', 'evening'), routine('b2', 'x', 'evening', 1)])];
      const both: TickedHere = { a: t0, b: t0 + 2_000 };
      expect(tiles(held(rows, ['a', 'b'], both, t0 + 3_000))).toEqual([['cory', 'a', true], ['sam', 'b', true]]);
      expect(tiles(held(rows, ['a', 'b'], both, t0 + 4_500))).toEqual([['cory', 'a2', false], ['sam', 'b', true]]);
      expect(tiles(held(rows, ['a', 'b'], both, t0 + 6_000))).toEqual([['cory', 'a2', false], ['sam', 'b2', false]]);
    });

    it('holds the latest when one person has two ticked here that are both still inside their four seconds', () => {
      const rows = [group(sam, [routine('x', 'x', 'evening'), routine('y', 'x', 'evening', 1), routine('z', 'x', 'evening', 2)])];
      expect(tiles(held(rows, ['x', 'y'], { x: t0, y: t0 + 1_000 }, t0 + 2_000))).toEqual([['sam', 'y', true]]);
    });

    it("holds a Routine of the part before, or Any time, as well as the part's own", () => {
      const rows = [group(sam, [routine('early', 'x', 'morning'), routine('any', 'x', null, 1), routine('own', 'x', 'evening', 2)])];
      expect(tiles(held(rows, ['early'], tick('early'), t0 + 1))).toEqual([['sam', 'early', true]]);
      expect(tiles(held(rows, ['any'], tick('any'), t0 + 1))).toEqual([['sam', 'any', true]]);
    });

    it('never changes the ticks it is given', () => {
      const ticked = Object.freeze({ stretch: t0 });
      expect(() => held(two, ['stretch'], ticked, t0 + 10)).not.toThrow();
      expect(ticked).toEqual({ stretch: t0 });
    });
  });

  describe('when a hold ends', () => {
    const t0 = 1_000_000;

    it('is when the earliest of the holds ends', () => {
      expect(holdEndsAt({ a: t0, b: t0 + 1_000 }, t0 + 10)).toBe(t0 + HOME_HOLD_MS);
      expect(holdEndsAt({ a: t0 + 500 }, t0)).toBe(t0 + 500 + HOME_HOLD_MS);
    });

    it('leaves out the holds that have ended, and is nothing when none is left', () => {
      expect(holdEndsAt({ a: t0, b: t0 + 3_000 }, t0 + HOME_HOLD_MS)).toBe(t0 + 3_000 + HOME_HOLD_MS);
      expect(holdEndsAt({ a: t0 }, t0 + HOME_HOLD_MS)).toBeNull();
      expect(holdEndsAt({}, t0)).toBeNull();
    });
  });
});

describe("the link in Up next's heading", () => {
  // One person with `more + 1` Routines to do: one tile, and `more` Routines it does not show.
  const link = (more: number) =>
    chartOf({ profiles: [P1], routines: Array.from({ length: more + 1 }, (_, index) => routine(`r${index}`, 'p1', null, index)) }).upNext().link;

  it('reads "All routines" when the tiles show everything left', () => {
    expect(link(0)).toEqual({ words: 'All routines', name: 'All routines' });
  });

  it('reads how many more there are when the tiles do not show them all, and is still named for where it goes', () => {
    expect(link(5)).toEqual({ words: '5 more', name: '5 more. All routines' });
    expect(link(1)).toEqual({ words: '1 more', name: '1 more. All routines' });
  });

  it('shows the visible words inside its name, so what a person reads is what a screen reader says', () => {
    for (const more of [0, 1, 2, 17]) {
      const { words, name } = link(more);
      expect(name.startsWith(words), String(more)).toBe(true);
    }
  });
});

// ---- A tick shown at once -----------------------------------------------------------------------------------

describe('a tick shown at once', () => {
  const read = (date: string): ChartRead => ({ date, routines: [], done: new Set(['a']) });

  it('is added to what was read for the day it was made on, and taken away for an untick', () => {
    expect([...tickedRead(read(THURSDAY), 'b', true, THURSDAY).done]).toEqual(['a', 'b']);
    expect([...tickedRead(read(THURSDAY), 'a', false, THURSDAY).done]).toEqual([]);
  });

  it('is not shown on a read made for another day, and leaves the read it was given as it was', () => {
    const other = read('2026-09-30');
    expect(tickedRead(other, 'b', true, THURSDAY)).toBe(other);
    const before = read(THURSDAY);
    tickedRead(before, 'b', true, THURSDAY);
    expect([...before.done]).toEqual(['a']);
  });
});

// ---- The chart over the real read, as a Device -------------------------------------------------------------

describe('the chart over the real read', () => {
  const households: HouseholdAccount[] = [];
  const tablets: Tablet[] = [];

  afterEach(async () => {
    await Promise.all(tablets.splice(0).map(destroyTablet));
    await Promise.all(households.splice(0).map(destroyHousehold));
  });

  it('a Device taps a Routine: the Routine Completion is written, read back, and the chart shows it done', async () => {
    const arranged = await createHousehold('The Andersons');
    households.push(arranged);
    const phone = await asHouseholdAccount(arranged);
    const householdId = arranged.household.id;
    const mom = await createProfile(phone, householdId, { name: 'Mom', color: PROFILE_PALETTE[0].hex, avatar_url: null }, 0);
    const walk = await createRoutine(phone, householdId, mom.id, { title: 'Walk the dog', days_of_week: maskOf([0, 1, 2, 3, 4, 5, 6]), time_of_day: 'morning' }, 0);
    const tablet = await asDevice(arranged);
    tablets.push(tablet);
    const wall = tablet.client;
    const today = householdDay(arranged.household.timezone);

    // The chart's read, as the hook builds it: the Routines and the day's completions, through the Device's client.
    let shown: ChartRead | null = null;
    const read = startSyncedRead<ChartRead>({
      load: async () => {
        const [routines, completed] = await Promise.all([loadRoutines(wall), loadCompletions(wall, today.date)]);
        return { date: today.date, routines, done: new Set(completed) };
      },
      onChange: (state) => {
        shown = state.data;
      },
    });
    try {
      await vi.waitFor(() => expect(shown).not.toBeNull());
      let state: ChartState = startChart('morning');
      const world = scene({ profiles: [mom], routines: [], clock: 'morning' });
      const effects = {
        ...world.effects,
        write: (routine: Routine, checking: boolean, date: string) =>
          read.write(
            () => (checking ? completeRoutine(wall, routine.id, date) : uncompleteRoutine(wall, routine.id, date)),
            (readNow) => tickedRead(readNow, routine.id, checking, date),
          ),
        change: (update: (was: ChartState) => ChartState) => {
          state = update(state);
        },
      };
      const chart = () => routineChart({ date: today.date, weekday: today.weekday, clock: 'morning', profiles: [mom], read: shown, readState: 'ready', failed: false }, state, effects);

      expect(chart().columnFor(mom.id)).toMatchObject({ progress: { done: 0, total: 1 }, finished: false });
      const tapped = await chart().tap(walk, { button: button(340), frame: frame(100, 4) });
      expect(tapped).toEqual({ saved: true, finished: true });
      expect(chart().columnFor(mom.id)!.burst).toMatchObject({ at: 276 });

      // The Routine Completion is in the database, for the Household date, and the read after the write shows it too.
      const stored = await asServiceRole().from('routine_completions').select('routine_id, completed_on').eq('routine_id', walk.id);
      expect(stored.data).toEqual([{ routine_id: walk.id, completed_on: today.date }]);
      await read.readBack();
      expect(chart().columnFor(mom.id)).toMatchObject({ progress: { done: 1, total: 1 }, finished: true });
      expect([...shown!.done]).toEqual([walk.id]);

      // Tapping it again takes the tick back, and the read shows it undone.
      expect(await chart().tap(walk, { button: button(340), frame: frame(100, 4) })).toEqual({ saved: true, finished: false });
      await read.readBack();
      expect(chart().columnFor(mom.id)).toMatchObject({ progress: { done: 0, total: 1 }, finished: false });
      expect(await loadCompletions(wall, today.date)).toEqual([]);
    } finally {
      read.stop();
    }
  });
});
