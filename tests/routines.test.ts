import { afterEach, describe, expect, it } from 'vitest';
import { PROFILE_PALETTE, createProfile, deleteProfile, movedIds, type Profile } from '../src/lib/profiles';
import {
  TIME_OF_DAY_GROUPS,
  WEEKDAYS,
  archiveRoutine,
  celebrate,
  completeRoutine,
  createRoutine,
  finishedProfiles,
  groupByProfile,
  groupByTimeOfDay,
  householdDay,
  isScheduledOn,
  loadCompletions,
  loadRoutines,
  maskOf,
  movedIdsInGroup,
  noCelebration,
  reorderRoutines,
  routineProgress,
  showsTimeOfDayHeadings,
  tapFinishesProfile,
  tickOptimistically,
  todaysRoutines,
  uncompleteRoutine,
  updateRoutine,
  type Celebration,
  type CelebrationEvent,
  type Routine,
} from '../src/lib/routines';
import {
  asAnonymous,
  asDevice,
  asHouseholdAccount,
  asServiceRole,
  asTablet,
  createHousehold,
  destroyHousehold,
  destroyTablet,
  type HouseholdAccount,
  type Tablet,
} from './support/supabase';

const red = PROFILE_PALETTE[0].hex;
const blue = PROFILE_PALETTE[7].hex;

const MON = 1;
const TUE = 2;
const WED = 3;
const SAT = 6;
const SUN = 0;

function routine(overrides: Partial<Routine> & Pick<Routine, 'id'>): Routine {
  return { profile_id: 'p1', title: 'Brush teeth', days_of_week: 127, time_of_day: null, picture: null, sort_order: 0, archived_at: null, ...overrides };
}

// The Household date `days` calendar days from `date` ('YYYY-MM-DD'). Stepping by 24 hours from now
// instead lands on the same date during the repeated hour of a 25 hour day, and can skip one on a 23 hour day.
function addDays(date: string, days: number): string {
  const moved = new Date(`${date}T00:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}

describe('weekday schedule', () => {
  it('packs weekdays into a bitmask, Sunday as bit 0', () => {
    expect(WEEKDAYS.map((day) => day.name)).toEqual(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
    expect(maskOf([])).toBe(0);
    expect(maskOf([SUN])).toBe(1);
    expect(maskOf([MON, WED])).toBe(0b0001010);
    expect(maskOf([0, 1, 2, 3, 4, 5, 6])).toBe(127);
    expect(maskOf([MON, MON])).toBe(maskOf([MON]));
  });

  it('says whether a mask is scheduled on a weekday', () => {
    const weekdaysOnly = maskOf([1, 2, 3, 4, 5]);
    expect(isScheduledOn(weekdaysOnly, MON)).toBe(true);
    expect(isScheduledOn(weekdaysOnly, SAT)).toBe(false);
    expect(isScheduledOn(weekdaysOnly, SUN)).toBe(false);
  });
});

describe('the Household day', () => {
  it('is the date and weekday in the Household Timezone, not the machine\'s', () => {
    // 03:30 UTC on Tuesday the 29th is still Monday evening in Chicago (CDT, UTC-5).
    const instant = new Date('2026-09-29T03:30:00Z');
    expect(householdDay('America/Chicago', instant)).toEqual({ date: '2026-09-28', weekday: MON });
    expect(householdDay('UTC', instant)).toEqual({ date: '2026-09-29', weekday: TUE });
    // Auckland is already Wednesday the 30th at 12:00 UTC (NZDT, UTC+13).
    expect(householdDay('Pacific/Auckland', new Date('2026-09-29T12:00:00Z'))).toEqual({ date: '2026-09-30', weekday: WED });
  });

  it('rolls over exactly at Household midnight', () => {
    expect(householdDay('America/Chicago', new Date('2026-09-29T04:59:59Z'))).toEqual({ date: '2026-09-28', weekday: MON });
    expect(householdDay('America/Chicago', new Date('2026-09-29T05:00:00Z'))).toEqual({ date: '2026-09-29', weekday: TUE });
  });

  it('follows daylight saving changes', () => {
    // Chicago falls back on 2026-11-01: 05:30Z is 00:30 CDT, 06:30Z is 00:30 CST, both the 1st.
    expect(householdDay('America/Chicago', new Date('2026-11-01T05:30:00Z')).date).toBe('2026-11-01');
    expect(householdDay('America/Chicago', new Date('2026-11-01T06:30:00Z')).date).toBe('2026-11-01');
    expect(householdDay('America/Chicago', new Date('2026-11-02T05:59:00Z')).date).toBe('2026-11-01');
    expect(householdDay('America/Chicago', new Date('2026-11-02T06:00:00Z')).date).toBe('2026-11-02');
  });

  it('steps by calendar days, where stepping by 24 hours repeats a date on a 25 hour day', () => {
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    // 23:30 CST, the last hour of the 25 hour day: 24 hours back is still the 1st, one calendar day back is the 31st.
    const lastHour = new Date('2026-11-02T05:30:00Z');
    expect(householdDay('America/Chicago', lastHour).date).toBe('2026-11-01');
    expect(householdDay('America/Chicago', new Date(lastHour.getTime() - 24 * 60 * 60 * 1000)).date).toBe('2026-11-01');
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31');
  });
});

describe("today's Routines", () => {
  const daily = routine({ id: 'daily', days_of_week: 127, sort_order: 2 });
  const weekdays = routine({ id: 'weekdays', days_of_week: maskOf([1, 2, 3, 4, 5]), sort_order: 0 });
  const weekend = routine({ id: 'weekend', days_of_week: maskOf([SAT, SUN]), sort_order: 1 });
  const archived = routine({ id: 'archived', days_of_week: 127, archived_at: '2026-09-01T00:00:00Z' });
  const all = [daily, weekdays, weekend, archived];

  it('keeps only the Routines scheduled for the weekday, in order, never archived ones', () => {
    expect(todaysRoutines(all, MON).map((r) => r.id)).toEqual(['weekdays', 'daily']);
    expect(todaysRoutines(all, SAT).map((r) => r.id)).toEqual(['weekend', 'daily']);
    expect(todaysRoutines(all, SUN).map((r) => r.id)).toEqual(['weekend', 'daily']);
  });

  it('follows the Household date across a timezone boundary', () => {
    // Saturday 23:30 in Chicago is already Sunday 04:30 UTC: the weekend Routine shows in both, the weekday one in neither.
    const instant = new Date('2026-09-27T04:30:00Z'); // Sunday in UTC, Saturday in Chicago
    expect(householdDay('UTC', instant).weekday).toBe(SUN);
    expect(householdDay('America/Chicago', instant).weekday).toBe(SAT);
    const friday = new Date('2026-10-03T04:30:00Z'); // Saturday in UTC, Friday in Chicago
    expect(todaysRoutines(all, householdDay('UTC', friday).weekday).map((r) => r.id)).toEqual(['weekend', 'daily']);
    expect(todaysRoutines(all, householdDay('America/Chicago', friday).weekday).map((r) => r.id)).toEqual(['weekdays', 'daily']);
  });

  it("groups under each Profile in the Profile's order, leaving out Profiles with nothing today", () => {
    const profiles: Profile[] = [
      { id: 'p1', name: 'Mom', color: red, avatar_url: null, sort_order: 0 },
      { id: 'p2', name: 'Sam', color: blue, avatar_url: null, sort_order: 1 },
      { id: 'p3', name: 'Dad', color: red, avatar_url: null, sort_order: 2 },
    ];
    const rows = [
      routine({ id: 'a', profile_id: 'p2', sort_order: 1 }),
      routine({ id: 'b', profile_id: 'p2', sort_order: 0 }),
      routine({ id: 'c', profile_id: 'p1', days_of_week: maskOf([SAT]) }),
    ];
    const groups = groupByProfile(profiles, todaysRoutines(rows, MON));
    expect(groups.map((g) => [g.profile.name, g.routines.map((r) => r.id)])).toEqual([['Sam', ['b', 'a']]]);
  });
});

describe('Routines by time of day', () => {
  const shown = (rows: Routine[]) => groupByTimeOfDay(rows).map((group) => [group.label, group.routines.map((r) => r.id)]);

  it('names the groups in the order the day happens, Any time last', () => {
    expect(TIME_OF_DAY_GROUPS.map((group) => [group.value, group.label])).toEqual([
      ['morning', 'Morning'],
      ['afternoon', 'Afternoon'],
      ['evening', 'Evening'],
      [null, 'Any time'],
    ]);
  });

  it('groups Morning, Afternoon, Evening, then Any time, whatever order the Routines arrive in', () => {
    const rows = [
      routine({ id: 'any', time_of_day: null, sort_order: 0 }),
      routine({ id: 'evening', time_of_day: 'evening', sort_order: 1 }),
      routine({ id: 'morning', time_of_day: 'morning', sort_order: 2 }),
      routine({ id: 'afternoon', time_of_day: 'afternoon', sort_order: 3 }),
    ];
    expect(shown(rows)).toEqual([
      ['Morning', ['morning']],
      ['Afternoon', ['afternoon']],
      ['Evening', ['evening']],
      ['Any time', ['any']],
    ]);
    // The list it was given is left as it was.
    expect(rows.map((r) => r.id)).toEqual(['any', 'evening', 'morning', 'afternoon']);
  });

  it('leaves out the groups with nothing in them', () => {
    expect(shown([routine({ id: 'any', time_of_day: null }), routine({ id: 'evening', time_of_day: 'evening' })])).toEqual([
      ['Evening', ['evening']],
      ['Any time', ['any']],
    ]);
    expect(shown([routine({ id: 'noon', time_of_day: 'afternoon' })])).toEqual([['Afternoon', ['noon']]]);
    expect(groupByTimeOfDay([])).toEqual([]);
  });

  it('keeps each group in sort_order', () => {
    const rows = [
      routine({ id: 'm3', time_of_day: 'morning', sort_order: 7 }),
      routine({ id: 'a2', time_of_day: null, sort_order: 9 }),
      routine({ id: 'm1', time_of_day: 'morning', sort_order: 1 }),
      routine({ id: 'm2', time_of_day: 'morning', sort_order: 5 }),
      routine({ id: 'a1', time_of_day: null, sort_order: 2 }),
    ];
    expect(shown(rows)).toEqual([
      ['Morning', ['m1', 'm2', 'm3']],
      ['Any time', ['a1', 'a2']],
    ]);
  });

  it('is a single Any time group when no Routine has a time of day', () => {
    const groups = groupByTimeOfDay([routine({ id: 'b', sort_order: 1 }), routine({ id: 'a', sort_order: 0 })]);
    expect(groups.map((group) => group.value)).toEqual([null]);
    expect(shown([routine({ id: 'b', sort_order: 1 }), routine({ id: 'a', sort_order: 0 })])).toEqual([['Any time', ['a', 'b']]]);
  });
});

describe("group headings over a Profile's Routines", () => {
  it('are left off when every Routine is Any time, so a Household that never sets a time of day sees what it always has', () => {
    expect(showsTimeOfDayHeadings([routine({ id: 'a' }), routine({ id: 'b', sort_order: 1 })])).toBe(false);
    expect(showsTimeOfDayHeadings([routine({ id: 'a' })])).toBe(false);
  });

  it('show as soon as one Routine has a time of day, Any time ones included', () => {
    expect(showsTimeOfDayHeadings([routine({ id: 'a' }), routine({ id: 'b', time_of_day: 'evening' })])).toBe(true);
    expect(showsTimeOfDayHeadings([routine({ id: 'b', time_of_day: 'morning' })])).toBe(true);
  });

  it('show when every Routine has a time of day', () => {
    expect(showsTimeOfDayHeadings([routine({ id: 'a', time_of_day: 'morning' }), routine({ id: 'b', time_of_day: 'afternoon' })])).toBe(true);
  });

  it('have nothing to head when there are no Routines', () => {
    expect(showsTimeOfDayHeadings([])).toBe(false);
  });
});

describe('moving a Routine inside its time of day group', () => {
  // Shown as Morning [a, c, e], Evening [b], Any time [d]: not the order of sort_order (a, b, c, d, e).
  const rows = [
    routine({ id: 'a', time_of_day: 'morning', sort_order: 0 }),
    routine({ id: 'b', time_of_day: 'evening', sort_order: 1 }),
    routine({ id: 'c', time_of_day: 'morning', sort_order: 2 }),
    routine({ id: 'd', time_of_day: null, sort_order: 3 }),
    routine({ id: 'e', time_of_day: 'morning', sort_order: 4 }),
  ];
  const shownOrder = ['a', 'c', 'e', 'b', 'd'];

  it('swaps a Routine with its neighbour in the same group and returns the whole list as shown', () => {
    expect(movedIdsInGroup(rows, 'c', -1)).toEqual(['c', 'a', 'e', 'b', 'd']);
    expect(movedIdsInGroup(rows, 'c', 1)).toEqual(['a', 'e', 'c', 'b', 'd']);
    expect(movedIdsInGroup(rows, 'e', -1)).toEqual(['a', 'e', 'c', 'b', 'd']);
  });

  it('keeps the order as shown at the edge of a group, and for a Routine alone in its group', () => {
    expect(movedIdsInGroup(rows, 'a', -1)).toEqual(shownOrder);
    // The bottom of Morning does not cross into Evening, and the top of Evening does not cross into Morning.
    expect(movedIdsInGroup(rows, 'e', 1)).toEqual(shownOrder);
    expect(movedIdsInGroup(rows, 'b', -1)).toEqual(shownOrder);
    expect(movedIdsInGroup(rows, 'b', 1)).toEqual(shownOrder);
    expect(movedIdsInGroup(rows, 'd', -1)).toEqual(shownOrder);
    expect(movedIdsInGroup(rows, 'd', 1)).toEqual(shownOrder);
  });

  it('leaves the order as shown for an id that is not in the list', () => {
    expect(movedIdsInGroup(rows, 'nobody', 1)).toEqual(shownOrder);
    expect(movedIdsInGroup([], 'a', 1)).toEqual([]);
  });

  it('is a plain move when every Routine is Any time', () => {
    const plain = ['x', 'y', 'z'].map((id, index) => routine({ id, sort_order: index }));
    for (const id of ['x', 'y', 'z']) {
      for (const offset of [-1, 1]) {
        expect(movedIdsInGroup(plain, id, offset)).toEqual(movedIds(['x', 'y', 'z'], id, offset));
      }
    }
  });
});

describe('optimistic tick', () => {
  function screen(initial: string[]) {
    let checked = new Set(initial);
    return {
      publish: (update: (ids: Set<string>) => Set<string>) => {
        checked = update(checked);
      },
      get: () => [...checked].sort(),
    };
  }

  it('shows the tick before the server answers and keeps it when the write lands', async () => {
    const view = screen([]);
    let shownWhileWriting: string[] = [];
    const stuck = await tickOptimistically(view.publish, 'r1', true, async () => {
      shownWhileWriting = view.get();
    });
    expect(shownWhileWriting).toEqual(['r1']);
    expect(stuck).toBe(true);
    expect(view.get()).toEqual(['r1']);
  });

  it('rolls a failed tick back, leaving other changes alone', async () => {
    const view = screen(['r2']);
    const stuck = await tickOptimistically(view.publish, 'r1', true, async () => {
      view.publish((ids) => new Set([...ids, 'r3']));
      throw new Error('offline');
    });
    expect(stuck).toBe(false);
    expect(view.get()).toEqual(['r2', 'r3']);
  });

  it('rolls a failed untick back to checked', async () => {
    const view = screen(['r1']);
    const stuck = await tickOptimistically(view.publish, 'r1', false, async () => {
      throw new Error('offline');
    });
    expect(stuck).toBe(false);
    expect(view.get()).toEqual(['r1']);
  });
});

describe("progress through a Profile's Routines today", () => {
  const mine = ['brush', 'bag', 'homework'].map((id, index) => routine({ id, sort_order: index }));

  it('is none done of all when nothing is ticked', () => {
    expect(routineProgress(mine, new Set())).toEqual({ done: 0, total: 3 });
  });

  it('counts the Routines ticked', () => {
    expect(routineProgress(mine, new Set(['bag']))).toEqual({ done: 1, total: 3 });
    expect(routineProgress(mine, new Set(['brush', 'homework']))).toEqual({ done: 2, total: 3 });
  });

  it('is all done when every Routine is ticked', () => {
    expect(routineProgress(mine, new Set(['brush', 'bag', 'homework']))).toEqual({ done: 3, total: 3 });
  });

  it('is nothing of nothing for a Profile with no Routines today', () => {
    expect(routineProgress([], new Set())).toEqual({ done: 0, total: 0 });
    expect(routineProgress([], new Set(['brush']))).toEqual({ done: 0, total: 0 });
  });

  it("ignores a completion that is not one of the Profile's Routines", () => {
    expect(routineProgress(mine, new Set(['someone-elses', 'bag']))).toEqual({ done: 1, total: 3 });
  });

  it("counts only today's Routines: not an archived one, not one for another weekday, and not a completion of either", () => {
    const daily = routine({ id: 'daily', sort_order: 0 });
    const weekdays = routine({ id: 'weekdays', days_of_week: maskOf([1, 2, 3, 4, 5]), sort_order: 1 });
    const weekend = routine({ id: 'weekend', days_of_week: maskOf([SAT, SUN]), sort_order: 2 });
    const archived = routine({ id: 'archived', archived_at: '2026-09-01T00:00:00Z', sort_order: 3 });
    const all = [daily, weekdays, weekend, archived];
    // Every one of them has a completion today, as a read of the day's completions would find.
    const everything = new Set(all.map((r) => r.id));

    expect(routineProgress(todaysRoutines(all, MON), everything)).toEqual({ done: 2, total: 2 });
    expect(routineProgress(todaysRoutines(all, SAT), new Set(['weekend']))).toEqual({ done: 1, total: 2 });
    expect(routineProgress(todaysRoutines(all, SAT), new Set(['weekdays', 'archived']))).toEqual({ done: 0, total: 2 });
  });

  it('is worked out for each Profile on its own', () => {
    const profiles: Profile[] = [
      { id: 'p1', name: 'Mom', color: red, avatar_url: null, sort_order: 0 },
      { id: 'p2', name: 'Sam', color: blue, avatar_url: null, sort_order: 1 },
    ];
    const rows = [
      routine({ id: 'a', profile_id: 'p1' }),
      routine({ id: 'b', profile_id: 'p2' }),
      routine({ id: 'c', profile_id: 'p2', sort_order: 1 }),
    ];
    const groups = groupByProfile(profiles, todaysRoutines(rows, MON));
    expect(groups.map((g) => routineProgress(g.routines, new Set(['a', 'b'])))).toEqual([
      { done: 1, total: 1 },
      { done: 1, total: 2 },
    ]);
  });
});

describe('a tap that finishes a Profile', () => {
  const three = ['a', 'b', 'c'].map((id, index) => routine({ id, sort_order: index }));
  // Whether ticking (or unticking) `id` finishes the Profile when `done` was ticked before the tap.
  const finishes = (done: string[], id: string, checked: boolean, rows: Routine[] = three) => tapFinishesProfile(rows, new Set(done), id, checked);

  it('is true for the tick of the last Routine left, whichever Routine that is', () => {
    expect(finishes(['a', 'b'], 'c', true)).toBe(true);
    expect(finishes(['c', 'a'], 'b', true)).toBe(true);
    expect(finishes(['b', 'c'], 'a', true)).toBe(true);
  });

  it('is false for a tick that leaves another Routine unticked', () => {
    expect(finishes([], 'a', true)).toBe(false);
    expect(finishes(['a'], 'b', true)).toBe(false);
    expect(finishes(['c'], 'a', true)).toBe(false);
  });

  it('is false for an untick, whether or not the Profile was done', () => {
    expect(finishes(['a', 'b', 'c'], 'c', false)).toBe(false);
    expect(finishes(['a', 'b', 'c'], 'a', false)).toBe(false);
    expect(finishes(['a', 'b'], 'b', false)).toBe(false);
    expect(finishes(['a'], 'a', false)).toBe(false);
  });

  it('is false for a tick when the Profile was already done', () => {
    expect(finishes(['a', 'b', 'c'], 'c', true)).toBe(false);
    expect(finishes(['a', 'b', 'c'], 'a', true)).toBe(false);
  });

  it('is true for the one tick of a Profile with one Routine', () => {
    const only = [routine({ id: 'only' })];
    expect(finishes([], 'only', true, only)).toBe(true);
    expect(finishes(['only'], 'only', true, only)).toBe(false);
    expect(finishes(['only'], 'only', false, only)).toBe(false);
  });

  it('is false for a Profile with no Routines today', () => {
    expect(finishes([], 'a', true, [])).toBe(false);
    expect(finishes(['a'], 'a', false, [])).toBe(false);
  });

  it("is false for the tick of a Routine that is not the Profile's, finished or not", () => {
    expect(finishes(['a', 'b'], 'elsewhere', true)).toBe(false);
    expect(finishes(['a', 'b', 'c'], 'elsewhere', true)).toBe(false);
  });

  it('counts only the Routines it is given, so a completion of an archived one does not finish a Profile early', () => {
    const today = todaysRoutines([...three, routine({ id: 'old', archived_at: '2026-09-01T00:00:00Z' })], MON);
    expect(finishes(['old', 'a'], 'b', true, today)).toBe(false);
    expect(finishes(['old', 'a', 'b'], 'c', true, today)).toBe(true);
  });

  it('leaves the set it was given as it was', () => {
    const before = new Set(['a', 'b']);
    expect(tapFinishesProfile(three, before, 'c', true)).toBe(true);
    expect([...before]).toEqual(['a', 'b']);
  });

  it('is true in exactly one case, over every state of three Routines and every tap: a tick of the one Routine left', () => {
    const ids = three.map((r) => r.id);
    for (let mask = 0; mask < 1 << ids.length; mask += 1) {
      const done = new Set(ids.filter((_, index) => (mask >> index) & 1));
      const left = ids.filter((id) => !done.has(id));
      for (const tapped of [...ids, 'elsewhere']) {
        for (const checked of [true, false]) {
          const expected = checked && left.length === 1 && left[0] === tapped;
          expect(tapFinishesProfile(three, done, tapped, checked), `done ${[...done]}, tapped ${tapped}, ticking ${checked}`).toBe(expected);
        }
      }
    }
  });
});

describe('the Profiles that are all done', () => {
  const mom = { id: 'p1', name: 'Mom', color: red, avatar_url: null, sort_order: 0 };
  const sam = { id: 'p2', name: 'Sam', color: blue, avatar_url: null, sort_order: 1 };
  const groups = [
    { profile: mom, routines: [routine({ id: 'a' }), routine({ id: 'b', sort_order: 1 })] },
    { profile: sam, routines: [routine({ id: 'c', profile_id: 'p2' })] },
  ];

  it('are the ones with every Routine today ticked', () => {
    expect([...finishedProfiles(groups, new Set(['a', 'b']))]).toEqual(['p1']);
    expect([...finishedProfiles(groups, new Set(['c']))]).toEqual(['p2']);
    expect([...finishedProfiles(groups, new Set(['a', 'b', 'c']))]).toEqual(['p1', 'p2']);
  });

  it('are none while every Profile has one left, or nothing is ticked', () => {
    expect(finishedProfiles(groups, new Set()).size).toBe(0);
    expect(finishedProfiles(groups, new Set(['a'])).size).toBe(0);
  });

  it('never include a Profile with no Routines today, or count a completion that is not its own', () => {
    expect(finishedProfiles([], new Set(['a'])).size).toBe(0);
    expect(finishedProfiles([{ profile: mom, routines: [] }], new Set(['a'])).size).toBe(0);
    expect([...finishedProfiles(groups, new Set(['a', 'c', 'elsewhere']))]).toEqual(['p2']);
  });
});

describe('the celebration of a finished Profile', () => {
  // Friday night, the first minute of Saturday, and the Monday the Profile's Routines return.
  const friday = '2026-10-02';
  const saturday = '2026-10-03';
  const monday = '2026-10-05';
  // `at` is how far down its group (px) the Routine that finished the Profile is.
  const finished = (profileId: string, day = friday, at = 40): CelebrationEvent => ({ type: 'finished', profileId, day, at });
  const landed = (profileId: string, id: number): CelebrationEvent => ({ type: 'landed', profileId, id });
  // What the screen shows: the day, and the Profiles whose groups are on it and finished.
  const shown = (day: string | null, ...profileIds: string[]): CelebrationEvent => ({ type: 'shown', day, finished: new Set(profileIds) });
  const play = (...events: CelebrationEvent[]): Celebration => events.reduce(celebrate, noCelebration);
  const celebrating = (state: Celebration) => Object.keys(state.bursts).sort();

  it('starts when a tap finishes a Profile, over that Profile only', () => {
    const state = play(finished('ava'));
    expect(celebrating(state)).toEqual(['ava']);
    expect(celebrating(noCelebration)).toEqual([]);
  });

  it('plays over two Profiles at once when two finish together', () => {
    expect(celebrating(play(finished('ava'), finished('ben')))).toEqual(['ava', 'ben']);
  });

  it('starts where the tapped Routine is in its group, each burst at its own', () => {
    const state = play(finished('ava', friday, 120), finished('ben', friday, 15));
    expect(state.bursts.ava!.at).toBe(120);
    expect(state.bursts.ben!.at).toBe(15);
  });

  it('starts again where the new tap was when a Profile finishes again', () => {
    const state = play(finished('ava', friday, 120), finished('ava', friday, 300));
    expect(state.bursts.ava!.at).toBe(300);
  });

  it('stays where it started while the screen goes on showing the Profile finished', () => {
    const state = play(finished('ava', friday, 120));
    expect(celebrate(state, shown(friday, 'ava')).bursts.ava!.at).toBe(120);
  });

  it('plays again when a Profile finishes again, as a new burst', () => {
    const first = play(finished('ava'));
    const again = celebrate(first, finished('ava'));
    expect(celebrating(again)).toEqual(['ava']);
    expect(again.bursts.ava!.id).not.toBe(first.bursts.ava!.id);
  });

  it('ends when its animation ends', () => {
    const state = play(finished('ava'), finished('ben'));
    const ended = celebrate(state, landed('ava', state.bursts.ava!.id));
    expect(celebrating(ended)).toEqual(['ben']);
  });

  it('is not ended by the landing of an older burst of the same Profile', () => {
    const first = play(finished('ava'));
    const second = celebrate(first, finished('ava'));
    expect(celebrate(second, landed('ava', first.bursts.ava!.id))).toBe(second);
  });

  it('is not ended by a landing for a Profile that is not celebrating', () => {
    const state = play(finished('ava'));
    expect(celebrate(state, landed('ben', 1))).toBe(state);
    expect(celebrate(noCelebration, landed('ava', 1))).toBe(noCelebration);
  });

  it('lasts while its Profile is still finished on the screen, and changes nothing', () => {
    const state = play(finished('ava'));
    expect(celebrate(state, shown(friday, 'ava'))).toBe(state);
    expect(celebrate(state, shown(friday, 'ava', 'ben'))).toBe(state);
    expect(celebrate(noCelebration, shown(friday, 'ava'))).toBe(noCelebration);
  });

  it('ends when the Profile is no longer finished, as with an untick, so nothing falls over "2 of 3"', () => {
    const state = play(finished('ava'), shown(friday, 'ava'));
    expect(celebrating(celebrate(state, shown(friday)))).toEqual([]);
  });

  it('ends when a tick is put back after a failed write, whichever tap it was', () => {
    // Ticked, shown finished, then the write failed and the tick went back.
    expect(celebrating(play(finished('ava'), shown(friday, 'ava'), shown(friday)))).toEqual([]);
    // One Profile's tick put back while another Profile's burst plays: only the one that lost its finish ends.
    expect(celebrating(play(finished('ava'), finished('ben'), shown(friday, 'ava', 'ben'), shown(friday, 'ben')))).toEqual(['ben']);
  });

  it('is not ended by an earlier tap failing while the Profile stays finished', () => {
    // Done already, then unticked, then ticked again (a burst). The untick's write now fails and puts its
    // Routine back: it is ticked either way, the Profile is still finished, and the burst plays on.
    const state = play(shown(friday, 'ava'), shown(friday), finished('ava'), shown(friday, 'ava'));
    expect(celebrating(state)).toEqual(['ava']);
    expect(celebrate(state, shown(friday, 'ava'))).toBe(state);
  });

  it("ends when its Profile's group leaves the screen, and only that Profile's", () => {
    const state = play(finished('ava'), finished('ben'));
    expect(celebrating(celebrate(state, shown(friday, 'ben')))).toEqual(['ben']);
  });

  it('is cleared for every Profile when the Household day changes', () => {
    const state = play(finished('ava'), finished('ben'));
    // Even a Profile the new day's read shows finished does not keep a burst the old day started.
    expect(celebrating(celebrate(state, shown(saturday, 'ava', 'ben')))).toEqual([]);
    expect(celebrating(celebrate(state, shown(saturday)))).toEqual([]);
  });

  it('cannot replay when the group comes back: finished at 23:59:59 on a Friday, gone from Saturday, back on Monday', () => {
    let state = play(finished('ava', friday));
    // Midnight: the Profile's Routines are not scheduled for Saturday, so its group leaves the screen.
    state = celebrate(state, shown(saturday));
    expect(celebrating(state)).toEqual([]);
    // Monday: the group comes back unfinished, and later finishes by a tick heard from another screen.
    state = celebrate(state, shown(monday));
    state = celebrate(state, shown(monday, 'ava'));
    expect(celebrating(state)).toEqual([]);
  });

  it('cannot replay when a group comes back on the same day either', () => {
    const state = play(finished('ava'), shown(friday), shown(friday, 'ava'));
    expect(celebrating(state)).toEqual([]);
  });

  it('does not carry a burst from another day into a new tap', () => {
    expect(celebrating(play(finished('ava', friday), finished('ben', saturday)))).toEqual(['ben']);
  });

  it('works on a screen that has no day yet', () => {
    expect(celebrate(noCelebration, shown(null))).toBe(noCelebration);
  });

  it('never changes the state or the sets it is given', () => {
    const frozen = Object.freeze({ day: friday, bursts: Object.freeze({ ava: Object.freeze({ id: 1, at: 0 }) }), issued: 1 });
    const finishedNow = Object.freeze(new Set(['ava']));
    expect(() => celebrate(frozen, finished('ben'))).not.toThrow();
    expect(() => celebrate(frozen, landed('ava', 1))).not.toThrow();
    expect(() => celebrate(frozen, { type: 'shown', day: friday, finished: finishedNow })).not.toThrow();
    expect(() => celebrate(frozen, { type: 'shown', day: saturday, finished: finishedNow })).not.toThrow();
    expect(frozen.bursts.ava.id).toBe(1);
    expect([...finishedNow]).toEqual(['ava']);
  });
});

describe('routines', () => {
  const households: HouseholdAccount[] = [];
  const tablets: Tablet[] = [];

  async function household(name: string) {
    const arranged = await createHousehold(name);
    households.push(arranged);
    const phone = await asHouseholdAccount(arranged);
    const profile = await createProfile(phone, arranged.household.id, { name: 'Mom', color: red, avatar_url: null }, 0);
    return { arranged, phone, profile, householdId: arranged.household.id };
  }

  async function device(account: HouseholdAccount) {
    const arranged = await asDevice(account);
    tablets.push(arranged);
    return arranged.client;
  }

  afterEach(async () => {
    await Promise.all(tablets.splice(0).map(destroyTablet));
    await Promise.all(households.splice(0).map(destroyHousehold));
  });

  const everyDay = maskOf([0, 1, 2, 3, 4, 5, 6]);

  it('a Household Account creates, reorders and archives Routines', async () => {
    const { phone, profile, householdId } = await household('The Andersons');

    const pills = await createRoutine(phone, householdId, profile.id, { title: ' Vitamins ', days_of_week: everyDay }, 0);
    const walk = await createRoutine(phone, householdId, profile.id, { title: 'Walk the dog', days_of_week: maskOf([MON, WED]) }, 1);
    expect(pills).toMatchObject({ title: 'Vitamins', profile_id: profile.id, days_of_week: everyDay, sort_order: 0, archived_at: null });
    expect((await loadRoutines(phone)).map((r) => r.title)).toEqual(['Vitamins', 'Walk the dog']);

    await reorderRoutines(phone, [walk.id, pills.id]);
    expect((await loadRoutines(phone)).map((r) => r.title)).toEqual(['Walk the dog', 'Vitamins']);

    await archiveRoutine(phone, walk.id);
    expect((await loadRoutines(phone)).map((r) => r.title)).toEqual(['Vitamins']);
    // Archived, not deleted: the row and its history stay.
    const kept = await asServiceRole().from('routines').select('archived_at').eq('id', walk.id).single();
    expect(kept.data?.archived_at).not.toBeNull();
  });

  it('a Household Account creates a Routine with a time of day, and without one', async () => {
    const { phone, profile, householdId } = await household('The Andersons');

    const made = [
      await createRoutine(phone, householdId, profile.id, { title: 'Vitamins', days_of_week: everyDay, time_of_day: 'morning' }, 0),
      await createRoutine(phone, householdId, profile.id, { title: 'Homework', days_of_week: everyDay, time_of_day: 'afternoon' }, 1),
      await createRoutine(phone, householdId, profile.id, { title: 'Brush teeth', days_of_week: everyDay, time_of_day: 'evening' }, 2),
      await createRoutine(phone, householdId, profile.id, { title: 'Walk the dog', days_of_week: everyDay, time_of_day: null }, 3),
      // Not saying a time of day is the same as any time.
      await createRoutine(phone, householdId, profile.id, { title: 'Water plants', days_of_week: everyDay }, 4),
    ];
    expect(made.map((r) => r.time_of_day)).toEqual(['morning', 'afternoon', 'evening', null, null]);
    // What the database holds, read back, not only what the insert echoed.
    expect((await loadRoutines(phone)).map((r) => [r.title, r.time_of_day])).toEqual([
      ['Vitamins', 'morning'],
      ['Homework', 'afternoon'],
      ['Brush teeth', 'evening'],
      ['Walk the dog', null],
      ['Water plants', null],
    ]);
  });

  it('refuses a time of day that is not morning, afternoon or evening, on create and on edit', async () => {
    const { phone, profile, householdId } = await household('The Andersons');
    const pills = await createRoutine(phone, householdId, profile.id, { title: 'Vitamins', days_of_week: everyDay, time_of_day: 'morning' }, 0);

    // The typed API cannot say "noon", so go around it: the database is what refuses.
    const create = await phone
      .from('routines')
      .insert({ household_id: householdId, profile_id: profile.id, title: 'Brunch', days_of_week: 1, time_of_day: 'noon' });
    expect(create.error?.code).toBe('23514');
    for (const unknown of ['noon', 'Morning', '']) {
      const edit = await phone.from('routines').update({ time_of_day: unknown }).eq('id', pills.id).select('id');
      expect(edit.error?.code).toBe('23514');
    }
    expect(await loadRoutines(phone)).toEqual([pills]);
  });

  it("a Household Account edits a Routine's title, days and time of day, and its Routine Completions survive", async () => {
    const { arranged, phone, profile, householdId } = await household('The Andersons');
    const walk = await createRoutine(phone, householdId, profile.id, { title: 'Wlak the dog', days_of_week: everyDay }, 0);
    const pills = await createRoutine(phone, householdId, profile.id, { title: 'Vitamins', days_of_week: everyDay, time_of_day: 'evening' }, 1);
    const today = householdDay(arranged.household.timezone).date;
    const yesterday = addDays(today, -1);

    // A day of history and today's tick, arranged as in the midnight test: tick, move it back a day, tick again.
    const admin = asServiceRole();
    await completeRoutine(phone, walk.id, today);
    await admin.from('routine_completions').update({ completed_on: yesterday }).eq('routine_id', walk.id);
    await completeRoutine(phone, walk.id, today);
    const completions = async () => (await admin.from('routine_completions').select('id, completed_on, completed_at').eq('routine_id', walk.id).order('completed_on')).data;
    const before = await completions();
    expect(before?.map((c) => c.completed_on)).toEqual([yesterday, today]);

    await updateRoutine(phone, walk.id, { title: ' Walk the dog ', days_of_week: maskOf([MON, WED]), time_of_day: 'morning', picture: null });

    // The three fields changed (the title trimmed); nothing else about it did, and no other Routine moved.
    const after = await loadRoutines(phone);
    expect(after.find((r) => r.id === walk.id)).toEqual({ ...walk, title: 'Walk the dog', days_of_week: maskOf([MON, WED]), time_of_day: 'morning' });
    expect(after.find((r) => r.id === pills.id)).toEqual(pills);
    // The same completion rows, untouched: yesterday's history and today's tick.
    expect(await completions()).toEqual(before);
    expect(await loadCompletions(phone, today)).toEqual([walk.id]);

    // The time of day can be taken away again: any time.
    await updateRoutine(phone, walk.id, { title: 'Walk the dog', days_of_week: everyDay, time_of_day: null, picture: null });
    expect((await loadRoutines(phone)).find((r) => r.id === walk.id)).toEqual({ ...walk, title: 'Walk the dog', time_of_day: null });
  });

  it('refuses an edit that leaves a blank title or no days, and keeps the Routine as it was', async () => {
    const { phone, profile, householdId } = await household('The Andersons');
    const pills = await createRoutine(phone, householdId, profile.id, { title: 'Vitamins', days_of_week: everyDay, time_of_day: 'morning' }, 0);

    await expect(updateRoutine(phone, pills.id, { title: '   ', days_of_week: everyDay, time_of_day: 'evening', picture: null })).rejects.toMatchObject({ code: '23514' });
    await expect(updateRoutine(phone, pills.id, { title: 'Vitamins', days_of_week: 0, time_of_day: 'evening', picture: null })).rejects.toMatchObject({ code: '23514' });
    expect(await loadRoutines(phone)).toEqual([pills]);
  });

  it('refuses an edit to an archived Routine and leaves it as it was', async () => {
    const { phone, profile, householdId } = await household('The Andersons');
    const pills = await createRoutine(phone, householdId, profile.id, { title: 'Vitamins', days_of_week: everyDay, time_of_day: 'morning' }, 0);
    await archiveRoutine(phone, pills.id);

    // It has left the phone's list, but a form left open on another screen can still hold its id.
    await expect(updateRoutine(phone, pills.id, { title: 'Renamed', days_of_week: 1, time_of_day: 'evening', picture: null })).rejects.toBeTruthy();

    const kept = await asServiceRole().from('routines').select('title, days_of_week, time_of_day, sort_order, archived_at').eq('id', pills.id).single();
    expect(kept.data).toMatchObject({ title: 'Vitamins', days_of_week: everyDay, time_of_day: 'morning', sort_order: 0 });
    expect(kept.data?.archived_at).not.toBeNull();
  });

  it('rejects a blank title, an empty or out-of-range schedule, and another Household\'s Profile', async () => {
    const { phone, profile, householdId } = await household('The Andersons');
    const { profile: foreignProfile } = await household('Other');

    await expect(createRoutine(phone, householdId, profile.id, { title: '   ', days_of_week: 1 }, 0)).rejects.toMatchObject({ code: '23514' });
    const tab = await phone.from('routines').insert({ household_id: householdId, profile_id: profile.id, title: '\t\n', days_of_week: 1 });
    expect(tab.error?.code).toBe('23514');
    await expect(createRoutine(phone, householdId, profile.id, { title: 'None', days_of_week: 0 }, 0)).rejects.toMatchObject({ code: '23514' });
    await expect(createRoutine(phone, householdId, profile.id, { title: 'Eight', days_of_week: 128 }, 0)).rejects.toMatchObject({ code: '23514' });
    // The Profile must belong to the same Household as the Routine.
    await expect(createRoutine(phone, householdId, foreignProfile.id, { title: 'Sneaky', days_of_week: 1 }, 0)).rejects.toMatchObject({ code: '23503' });
    expect(await loadRoutines(phone)).toEqual([]);
  });

  it("another household's account sees nothing and can change nothing", async () => {
    const ours = await household('Ours');
    const theirs = await household('Theirs');
    const mine = await createRoutine(ours.phone, ours.householdId, ours.profile.id, { title: 'Vitamins', days_of_week: everyDay }, 0);

    expect(await loadRoutines(theirs.phone)).toEqual([]);
    await archiveRoutine(theirs.phone, mine.id);
    await expect(reorderRoutines(theirs.phone, [mine.id])).rejects.toBeTruthy();
    await expect(createRoutine(theirs.phone, ours.householdId, ours.profile.id, { title: 'Planted', days_of_week: 1 }, 1)).rejects.toBeTruthy();
    expect(await loadRoutines(ours.phone)).toEqual([mine]);
  });

  it("another household's account and Device can neither read a Routine's time of day nor edit it", async () => {
    const ours = await household('Ours');
    const theirs = await household('Theirs');
    const mine = await createRoutine(ours.phone, ours.householdId, ours.profile.id, { title: 'Vitamins', days_of_week: everyDay, time_of_day: 'morning' }, 0);
    const theirWall = await device(theirs.arranged);
    const hijack = { title: 'Hijacked', days_of_week: 1, time_of_day: 'evening', picture: null } as const;

    expect(await loadRoutines(theirs.phone)).toEqual([]);
    expect(await loadRoutines(theirWall)).toEqual([]);
    await expect(updateRoutine(theirs.phone, mine.id, hijack)).rejects.toBeTruthy();
    await expect(updateRoutine(theirWall, mine.id, hijack)).rejects.toBeTruthy();
    await expect(createRoutine(theirs.phone, ours.householdId, ours.profile.id, { ...hijack, title: 'Planted' }, 1)).rejects.toBeTruthy();
    expect(await loadRoutines(ours.phone)).toEqual([mine]);
  });

  it('a Device reads Routines but cannot create, edit, archive or reorder them', async () => {
    const { arranged, phone, profile, householdId } = await household('The Andersons');
    const pills = await createRoutine(phone, householdId, profile.id, { title: 'Vitamins', days_of_week: everyDay }, 0);
    const wall = await device(arranged);

    expect(await loadRoutines(wall)).toEqual([pills]);

    await expect(createRoutine(wall, householdId, profile.id, { title: 'Sneaky', days_of_week: 1 }, 1)).rejects.toMatchObject({ code: '42501' });
    const update = await wall.from('routines').update({ title: 'Renamed' }).eq('id', pills.id).select('id');
    expect(update.data).toEqual([]);
    await expect(archiveRoutine(wall, pills.id)).resolves.toBeUndefined();
    await expect(reorderRoutines(wall, [pills.id])).rejects.toBeTruthy();
    expect(await loadRoutines(phone)).toEqual([pills]);
  });

  it("a Device reads a Routine's time of day but can neither create nor edit one", async () => {
    const { arranged, phone, profile, householdId } = await household('The Andersons');
    const pills = await createRoutine(phone, householdId, profile.id, { title: 'Vitamins', days_of_week: everyDay, time_of_day: 'morning' }, 0);
    const wall = await device(arranged);

    expect((await loadRoutines(wall)).map((r) => r.time_of_day)).toEqual(['morning']);
    expect(await loadRoutines(wall)).toEqual([pills]);

    await expect(createRoutine(wall, householdId, profile.id, { title: 'Sneaky', days_of_week: 1, time_of_day: 'evening' }, 1)).rejects.toBeTruthy();
    await expect(updateRoutine(wall, pills.id, { title: 'Renamed', days_of_week: 1, time_of_day: 'evening', picture: null })).rejects.toBeTruthy();
    // Nor by writing the column on its own.
    const raw = await wall.from('routines').update({ time_of_day: 'evening' }).eq('id', pills.id).select('id');
    expect(raw.data ?? []).toEqual([]);
    expect(await loadRoutines(phone)).toEqual([pills]);
  });

  it('an unpaired tablet reads no Routines and can neither create one nor edit one', async () => {
    const { phone, profile, householdId } = await household('The Andersons');
    const pills = await createRoutine(phone, householdId, profile.id, { title: 'Vitamins', days_of_week: everyDay, time_of_day: 'morning' }, 0);
    // An anonymous session that was never paired runs as `authenticated` and holds the column grants,
    // time_of_day included, so only row-level security keeps it out.
    const tablet = await asTablet();
    tablets.push(tablet);

    expect(await loadRoutines(tablet.client)).toEqual([]);
    await expect(createRoutine(tablet.client, householdId, profile.id, { title: 'Planted', days_of_week: 1, time_of_day: 'evening' }, 1)).rejects.toBeTruthy();
    await expect(updateRoutine(tablet.client, pills.id, { title: 'Hijacked', days_of_week: 1, time_of_day: 'evening', picture: null })).rejects.toBeTruthy();
    const raw = await tablet.client.from('routines').update({ time_of_day: 'evening' }).eq('id', pills.id).select('id');
    expect(raw.data ?? []).toEqual([]);
    expect(await loadRoutines(phone)).toEqual([pills]);
  });

  it('a Device ticks and unticks a Routine for today, once per day', async () => {
    const { arranged, phone, profile, householdId } = await household('The Andersons');
    const pills = await createRoutine(phone, householdId, profile.id, { title: 'Vitamins', days_of_week: everyDay }, 0);
    const wall = await device(arranged);
    const today = householdDay(arranged.household.timezone).date;

    expect(await loadCompletions(wall, today)).toEqual([]);
    await completeRoutine(wall, pills.id, today);
    expect(await loadCompletions(wall, today)).toEqual([pills.id]);
    // The Household Account sees the same completion.
    expect(await loadCompletions(phone, today)).toEqual([pills.id]);

    // Ticking twice is one completion, not an error: another tablet may have ticked first.
    await expect(completeRoutine(wall, pills.id, today)).resolves.toBeUndefined();
    const rows = await asServiceRole().from('routine_completions').select('routine_id, completed_on, completed_at').eq('routine_id', pills.id);
    expect(rows.data).toHaveLength(1);
    expect(rows.data?.[0]?.completed_at).toBeTruthy();

    await uncompleteRoutine(wall, pills.id, today);
    expect(await loadCompletions(wall, today)).toEqual([]);
  });

  it("a Household Account ticks a Routine too", async () => {
    const { arranged, phone, profile, householdId } = await household('The Andersons');
    const pills = await createRoutine(phone, householdId, profile.id, { title: 'Vitamins', days_of_week: everyDay }, 0);
    const today = householdDay(arranged.household.timezone).date;
    await completeRoutine(phone, pills.id, today);
    expect(await loadCompletions(phone, today)).toEqual([pills.id]);
  });

  it("yesterday's completions do not show as checked today, and are kept", async () => {
    const { arranged, phone, profile, householdId } = await household('The Andersons');
    const pills = await createRoutine(phone, householdId, profile.id, { title: 'Vitamins', days_of_week: everyDay }, 0);
    const wall = await device(arranged);
    const today = householdDay(arranged.household.timezone).date;
    const yesterday = addDays(today, -1);

    // History arranged by moving today's completion back a day, as if ticked yesterday.
    await completeRoutine(wall, pills.id, today);
    const admin = asServiceRole();
    const moved = await admin.from('routine_completions').update({ completed_on: yesterday }).eq('routine_id', pills.id);
    expect(moved.error).toBeNull();

    expect(await loadCompletions(wall, today)).toEqual([]);
    expect(await loadCompletions(wall, yesterday)).toEqual([pills.id]);

    // A tablet still showing yesterday just after midnight cannot erase it: unticks reach today only.
    await uncompleteRoutine(wall, pills.id, yesterday);
    expect(await loadCompletions(wall, yesterday)).toEqual([pills.id]);
    await uncompleteRoutine(phone, pills.id, yesterday);
    expect(await loadCompletions(phone, yesterday)).toEqual([pills.id]);

    // Today's tick is its own record; yesterday's stays.
    await completeRoutine(wall, pills.id, today);
    const rows = await admin.from('routine_completions').select('completed_on').eq('routine_id', pills.id).order('completed_on');
    expect(rows.data?.map((r) => r.completed_on)).toEqual([yesterday, today]);
  });

  it('refuses a completion for any day but the Household\'s today', async () => {
    const { arranged, phone, profile, householdId } = await household('The Andersons');
    const pills = await createRoutine(phone, householdId, profile.id, { title: 'Vitamins', days_of_week: everyDay }, 0);
    const wall = await device(arranged);
    const today = householdDay(arranged.household.timezone).date;
    const yesterday = addDays(today, -1);
    const tomorrow = addDays(today, 1);

    await expect(completeRoutine(wall, pills.id, yesterday)).rejects.toMatchObject({ code: '23514' });
    await expect(completeRoutine(wall, pills.id, tomorrow)).rejects.toMatchObject({ code: '23514' });
    expect((await asServiceRole().from('routine_completions').select('id').eq('routine_id', pills.id)).data).toEqual([]);
  });

  it('refuses a tick on an archived Routine', async () => {
    const { arranged, phone, profile, householdId } = await household('The Andersons');
    const pills = await createRoutine(phone, householdId, profile.id, { title: 'Vitamins', days_of_week: everyDay }, 0);
    const wall = await device(arranged);
    await archiveRoutine(phone, pills.id);

    await expect(completeRoutine(wall, pills.id, householdDay(arranged.household.timezone).date)).rejects.toMatchObject({ code: '42501' });
  });

  it("a Device cannot tick another household's Routine or edit a completion", async () => {
    const ours = await household('Ours');
    const theirs = await household('Theirs');
    const mine = await createRoutine(ours.phone, ours.householdId, ours.profile.id, { title: 'Vitamins', days_of_week: everyDay }, 0);
    const theirWall = await device(theirs.arranged);
    const ourWall = await device(ours.arranged);
    const today = householdDay(ours.arranged.household.timezone).date;

    await expect(completeRoutine(theirWall, mine.id, today)).rejects.toBeTruthy();
    await completeRoutine(ourWall, mine.id, today);
    expect(await loadCompletions(theirWall, today)).toEqual([]);
    await uncompleteRoutine(theirWall, mine.id, today);
    expect(await loadCompletions(ourWall, today)).toEqual([mine.id]);

    // Only the tick and the untick move: not the day, not the routine, not the time.
    const edit = await ourWall.from('routine_completions').update({ completed_on: '2020-01-01' }).eq('routine_id', mine.id).select('id');
    expect(edit.error).toBeTruthy();
    expect(await loadCompletions(ourWall, today)).toEqual([mine.id]);
  });

  it('a visitor with no session reads nothing and writes nothing', async () => {
    const { phone, profile, householdId } = await household('The Andersons');
    const pills = await createRoutine(phone, householdId, profile.id, { title: 'Vitamins', days_of_week: everyDay }, 0);

    const visitor = asAnonymous();
    expect((await visitor.from('routines').select('id')).error).toBeTruthy();
    expect((await visitor.from('routine_completions').select('id')).error).toBeTruthy();
    await expect(completeRoutine(visitor, pills.id, householdDay('America/Chicago').date)).rejects.toBeTruthy();
  });

  it("a visitor with no session can neither read a Routine's time of day nor create or edit one", async () => {
    const { phone, profile, householdId } = await household('The Andersons');
    const pills = await createRoutine(phone, householdId, profile.id, { title: 'Vitamins', days_of_week: everyDay, time_of_day: 'morning' }, 0);

    const visitor = asAnonymous();
    expect((await visitor.from('routines').select('time_of_day')).error).toBeTruthy();
    await expect(createRoutine(visitor, householdId, profile.id, { title: 'Planted', days_of_week: 1, time_of_day: 'evening' }, 1)).rejects.toBeTruthy();
    await expect(updateRoutine(visitor, pills.id, { title: 'Hijacked', days_of_week: 1, time_of_day: 'evening', picture: null })).rejects.toBeTruthy();
    expect(await loadRoutines(phone)).toEqual([pills]);
  });

  it("a Household Account sets, changes and clears a Routine's picture, and makes a Routine with one or without", async () => {
    const { phone, profile, householdId } = await household('The Andersons');

    const made = [
      await createRoutine(phone, householdId, profile.id, { title: 'Brush teeth', days_of_week: everyDay, picture: 'teeth' }, 0),
      await createRoutine(phone, householdId, profile.id, { title: 'Walk the dog', days_of_week: everyDay, picture: null }, 1),
      // Not saying a picture is the same as none.
      await createRoutine(phone, householdId, profile.id, { title: 'Water plants', days_of_week: everyDay }, 2),
      // The database keeps no list of pictures: a key this build does not know is stored as it is.
      await createRoutine(phone, householdId, profile.id, { title: 'Juggle', days_of_week: everyDay, picture: 'juggling' }, 3),
    ];
    expect(made.map((r) => r.picture)).toEqual(['teeth', null, null, 'juggling']);
    // What the database holds, read back, not only what the insert echoed.
    expect((await loadRoutines(phone)).map((r) => [r.title, r.picture])).toEqual([
      ['Brush teeth', 'teeth'],
      ['Walk the dog', null],
      ['Water plants', null],
      ['Juggle', 'juggling'],
    ]);

    // Changed, then cleared, then set again: nothing else about the Routine moves.
    const teeth = made[0]!;
    const setPicture = (picture: string | null) =>
      updateRoutine(phone, teeth.id, { title: teeth.title, days_of_week: teeth.days_of_week, time_of_day: teeth.time_of_day, picture });
    const read = async () => (await loadRoutines(phone)).find((r) => r.id === teeth.id);
    await setPicture('bed');
    expect(await read()).toEqual({ ...teeth, picture: 'bed' });
    await setPicture(null);
    expect(await read()).toEqual({ ...teeth, picture: null });
    await setPicture('shower');
    expect(await read()).toEqual({ ...teeth, picture: 'shower' });
  });

  it("an edit sends the picture as the form holds it, and leaves the Routine Completions alone", async () => {
    const { arranged, phone, profile, householdId } = await household('The Andersons');
    const walk = await createRoutine(phone, householdId, profile.id, { title: 'Walk the dog', days_of_week: everyDay, picture: 'pet' }, 0);
    const today = householdDay(arranged.household.timezone).date;
    await completeRoutine(phone, walk.id, today);

    await updateRoutine(phone, walk.id, { title: 'Walk the dog', days_of_week: maskOf([MON]), time_of_day: 'evening', picture: walk.picture });
    expect((await loadRoutines(phone)).find((r) => r.id === walk.id)).toEqual({ ...walk, days_of_week: maskOf([MON]), time_of_day: 'evening' });
    await updateRoutine(phone, walk.id, { title: 'Walk the dog', days_of_week: maskOf([MON]), time_of_day: 'evening', picture: 'sport' });
    expect((await loadRoutines(phone)).find((r) => r.id === walk.id)?.picture).toBe('sport');
    expect(await loadCompletions(phone, today)).toEqual([walk.id]);
  });

  it('accepts a picture key of 32 characters and refuses one of 33 or a blank one, on create and on edit', async () => {
    const { phone, profile, householdId } = await household('The Andersons');
    const pills = await createRoutine(phone, householdId, profile.id, { title: 'Vitamins', days_of_week: everyDay, picture: 'medicine' }, 0);
    const longest = 'k'.repeat(32);
    const tooLong = 'k'.repeat(33);

    expect((await createRoutine(phone, householdId, profile.id, { title: 'Longest', days_of_week: everyDay, picture: longest }, 1)).picture).toBe(longest);
    await expect(createRoutine(phone, householdId, profile.id, { title: 'Too long', days_of_week: everyDay, picture: tooLong }, 2)).rejects.toMatchObject({ code: '23514' });
    await expect(createRoutine(phone, householdId, profile.id, { title: 'Blank', days_of_week: everyDay, picture: '' }, 2)).rejects.toMatchObject({ code: '23514' });
    const edit = (picture: string) => updateRoutine(phone, pills.id, { title: 'Vitamins', days_of_week: everyDay, time_of_day: null, picture });
    await expect(edit(tooLong)).rejects.toMatchObject({ code: '23514' });
    await expect(edit('')).rejects.toMatchObject({ code: '23514' });
    await expect(edit(longest)).resolves.toBeUndefined();
    await expect(edit('medicine')).resolves.toBeUndefined();

    expect((await loadRoutines(phone)).map((r) => [r.title, r.picture])).toEqual([
      ['Vitamins', 'medicine'],
      ['Longest', longest],
    ]);
  });

  it("another household's account and Device can neither read a Routine's picture nor set it", async () => {
    const ours = await household('Ours');
    const theirs = await household('Theirs');
    const mine = await createRoutine(ours.phone, ours.householdId, ours.profile.id, { title: 'Vitamins', days_of_week: everyDay, picture: 'medicine' }, 0);
    const theirWall = await device(theirs.arranged);
    const hijack = { title: 'Hijacked', days_of_week: 1, time_of_day: null, picture: 'bed' } as const;

    expect(await loadRoutines(theirs.phone)).toEqual([]);
    expect(await loadRoutines(theirWall)).toEqual([]);
    await expect(updateRoutine(theirs.phone, mine.id, hijack)).rejects.toBeTruthy();
    await expect(updateRoutine(theirWall, mine.id, hijack)).rejects.toBeTruthy();
    await expect(createRoutine(theirs.phone, ours.householdId, ours.profile.id, { ...hijack, title: 'Planted' }, 1)).rejects.toBeTruthy();
    expect(await loadRoutines(ours.phone)).toEqual([mine]);
  });

  it("a Device reads a Routine's picture but can neither create a Routine with one nor set or clear one", async () => {
    const { arranged, phone, profile, householdId } = await household('The Andersons');
    const pills = await createRoutine(phone, householdId, profile.id, { title: 'Vitamins', days_of_week: everyDay, picture: 'medicine' }, 0);
    const wall = await device(arranged);

    expect((await loadRoutines(wall)).map((r) => r.picture)).toEqual(['medicine']);
    expect(await loadRoutines(wall)).toEqual([pills]);

    await expect(createRoutine(wall, householdId, profile.id, { title: 'Sneaky', days_of_week: 1, picture: 'bed' }, 1)).rejects.toMatchObject({ code: '42501' });
    await expect(updateRoutine(wall, pills.id, { title: 'Vitamins', days_of_week: everyDay, time_of_day: null, picture: 'bed' })).rejects.toBeTruthy();
    // Nor by writing the column on its own, or by clearing it.
    for (const picture of ['bed', null]) {
      const raw = await wall.from('routines').update({ picture }).eq('id', pills.id).select('id');
      expect(raw.data ?? []).toEqual([]);
    }
    expect(await loadRoutines(phone)).toEqual([pills]);
  });

  it("an unpaired tablet reads no Routine's picture and can neither create a Routine with one nor set one", async () => {
    const { phone, profile, householdId } = await household('The Andersons');
    const pills = await createRoutine(phone, householdId, profile.id, { title: 'Vitamins', days_of_week: everyDay, picture: 'medicine' }, 0);
    // An anonymous session that was never paired runs as `authenticated` and holds the column grants, picture
    // included, so only row-level security keeps it out.
    const tablet = await asTablet();
    tablets.push(tablet);

    expect(await loadRoutines(tablet.client)).toEqual([]);
    await expect(createRoutine(tablet.client, householdId, profile.id, { title: 'Planted', days_of_week: 1, picture: 'bed' }, 1)).rejects.toBeTruthy();
    await expect(updateRoutine(tablet.client, pills.id, { title: 'Hijacked', days_of_week: 1, time_of_day: null, picture: 'bed' })).rejects.toBeTruthy();
    const raw = await tablet.client.from('routines').update({ picture: 'bed' }).eq('id', pills.id).select('id');
    expect(raw.data ?? []).toEqual([]);
    expect(await loadRoutines(phone)).toEqual([pills]);
  });

  it("a visitor with no session can neither read a Routine's picture nor create a Routine with one or set one", async () => {
    const { phone, profile, householdId } = await household('The Andersons');
    const pills = await createRoutine(phone, householdId, profile.id, { title: 'Vitamins', days_of_week: everyDay, picture: 'medicine' }, 0);

    const visitor = asAnonymous();
    expect((await visitor.from('routines').select('picture')).error).toBeTruthy();
    await expect(createRoutine(visitor, householdId, profile.id, { title: 'Planted', days_of_week: 1, picture: 'bed' }, 1)).rejects.toBeTruthy();
    await expect(updateRoutine(visitor, pills.id, { title: 'Hijacked', days_of_week: 1, time_of_day: null, picture: 'bed' })).rejects.toBeTruthy();
    expect(await loadRoutines(phone)).toEqual([pills]);
  });

  it('deleting a Profile removes its Routines and their completions, and only its own', async () => {
    const { arranged, phone, profile, householdId } = await household('The Andersons');
    const sam = await createProfile(phone, householdId, { name: 'Sam', color: blue, avatar_url: null }, 1);
    const moms = await createRoutine(phone, householdId, profile.id, { title: 'Vitamins', days_of_week: everyDay }, 0);
    const sams = await createRoutine(phone, householdId, sam.id, { title: 'Homework', days_of_week: everyDay }, 0);
    const today = householdDay(arranged.household.timezone).date;
    await completeRoutine(phone, moms.id, today);
    await completeRoutine(phone, sams.id, today);

    await deleteProfile(phone, profile.id);

    expect((await loadRoutines(phone)).map((r) => r.id)).toEqual([sams.id]);
    expect(await loadCompletions(phone, today)).toEqual([sams.id]);
    const orphaned = await asServiceRole().from('routines').select('id').eq('profile_id', profile.id);
    expect(orphaned.data).toEqual([]);
  });

  it('deleting a Household deletes its Routines and completions', async () => {
    const { arranged, phone, profile, householdId } = await household('The Andersons');
    const pills = await createRoutine(phone, householdId, profile.id, { title: 'Vitamins', days_of_week: everyDay }, 0);
    await completeRoutine(phone, pills.id, householdDay(arranged.household.timezone).date);

    await destroyHousehold(arranged);
    households.splice(households.indexOf(arranged), 1);

    const admin = asServiceRole();
    expect((await admin.from('routines').select('id').eq('household_id', householdId)).data).toEqual([]);
    expect((await admin.from('routine_completions').select('id').eq('routine_id', pills.id)).data).toEqual([]);
  });

  it('a reorder that names a Routine it cannot move changes nothing', async () => {
    const ours = await household('The Andersons');
    const other = await household('Other');
    const a = await createRoutine(ours.phone, ours.householdId, ours.profile.id, { title: 'A', days_of_week: 1 }, 0);
    const b = await createRoutine(ours.phone, ours.householdId, ours.profile.id, { title: 'B', days_of_week: 1 }, 1);
    const foreign = await createRoutine(other.phone, other.householdId, other.profile.id, { title: 'F', days_of_week: 1 }, 0);

    await expect(reorderRoutines(ours.phone, [b.id, foreign.id, a.id])).rejects.toBeTruthy();

    expect((await loadRoutines(ours.phone)).map((r) => r.title)).toEqual(['A', 'B']);
    expect((await loadRoutines(other.phone)).map((r) => r.sort_order)).toEqual([0]);
  });

  it('a move inside a time of day group leaves sort_order equal to the order on screen', async () => {
    const { phone, profile, householdId } = await household('The Andersons');
    const make = (title: string, time_of_day: Routine['time_of_day'], sortOrder: number) =>
      createRoutine(phone, householdId, profile.id, { title, days_of_week: everyDay, time_of_day }, sortOrder);
    await make('A', 'morning', 0);
    await make('B', 'evening', 1);
    const c = await make('C', 'morning', 2);
    await make('D', null, 3);
    await make('E', 'morning', 4);

    // What the phone lists: Morning [A, C, E], Evening [B], Any time [D], not the order of sort_order.
    const onScreen = async () => groupByTimeOfDay(await loadRoutines(phone)).flatMap((group) => group.routines.map((r) => r.title));
    expect(await onScreen()).toEqual(['A', 'C', 'E', 'B', 'D']);
    expect((await loadRoutines(phone)).map((r) => r.title)).toEqual(['A', 'B', 'C', 'D', 'E']);

    // Moving C up sends the whole list as shown, so the next read agrees with the screen.
    await reorderRoutines(phone, movedIdsInGroup(await loadRoutines(phone), c.id, -1));
    const moved = await loadRoutines(phone);
    expect(moved.map((r) => [r.title, r.sort_order])).toEqual([['C', 0], ['A', 1], ['E', 2], ['B', 3], ['D', 4]]);
    expect(await onScreen()).toEqual(['C', 'A', 'E', 'B', 'D']);

    // Moving it down twice brings it to the bottom of Morning; a third move changes nothing and
    // never carries it into Evening.
    for (let step = 0; step < 3; step += 1) {
      await reorderRoutines(phone, movedIdsInGroup(await loadRoutines(phone), c.id, 1));
    }
    expect((await loadRoutines(phone)).map((r) => [r.title, r.sort_order])).toEqual([['A', 0], ['E', 1], ['C', 2], ['B', 3], ['D', 4]]);
    expect(await onScreen()).toEqual(['A', 'E', 'C', 'B', 'D']);
  });
});
