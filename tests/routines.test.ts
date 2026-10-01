import { afterEach, describe, expect, it } from 'vitest';
import { PROFILE_PALETTE, createProfile, deleteProfile, movedIds, type Profile } from '../src/lib/profiles';
import {
  TIME_OF_DAY_GROUPS,
  WEEKDAYS,
  archiveRoutine,
  completeRoutine,
  createRoutine,
  groupByProfile,
  groupByTimeOfDay,
  householdDay,
  isScheduledOn,
  loadCompletions,
  loadRoutines,
  maskOf,
  movedIdsInGroup,
  reorderRoutines,
  tickOptimistically,
  todaysRoutines,
  uncompleteRoutine,
  updateRoutine,
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
  return { profile_id: 'p1', title: 'Brush teeth', days_of_week: 127, time_of_day: null, sort_order: 0, archived_at: null, ...overrides };
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
    const yesterday = householdDay(arranged.household.timezone, new Date(Date.now() - 24 * 60 * 60 * 1000)).date;

    // A day of history and today's tick, arranged as in the midnight test: tick, move it back a day, tick again.
    const admin = asServiceRole();
    await completeRoutine(phone, walk.id, today);
    await admin.from('routine_completions').update({ completed_on: yesterday }).eq('routine_id', walk.id);
    await completeRoutine(phone, walk.id, today);
    const completions = async () => (await admin.from('routine_completions').select('id, completed_on, completed_at').eq('routine_id', walk.id).order('completed_on')).data;
    const before = await completions();
    expect(before?.map((c) => c.completed_on)).toEqual([yesterday, today]);

    await updateRoutine(phone, walk.id, { title: ' Walk the dog ', days_of_week: maskOf([MON, WED]), time_of_day: 'morning' });

    // The three fields changed (the title trimmed); nothing else about it did, and no other Routine moved.
    const after = await loadRoutines(phone);
    expect(after.find((r) => r.id === walk.id)).toEqual({ ...walk, title: 'Walk the dog', days_of_week: maskOf([MON, WED]), time_of_day: 'morning' });
    expect(after.find((r) => r.id === pills.id)).toEqual(pills);
    // The same completion rows, untouched: yesterday's history and today's tick.
    expect(await completions()).toEqual(before);
    expect(await loadCompletions(phone, today)).toEqual([walk.id]);

    // The time of day can be taken away again: any time.
    await updateRoutine(phone, walk.id, { title: 'Walk the dog', days_of_week: everyDay, time_of_day: null });
    expect((await loadRoutines(phone)).find((r) => r.id === walk.id)).toEqual({ ...walk, title: 'Walk the dog', time_of_day: null });
  });

  it('refuses an edit that leaves a blank title or no days, and keeps the Routine as it was', async () => {
    const { phone, profile, householdId } = await household('The Andersons');
    const pills = await createRoutine(phone, householdId, profile.id, { title: 'Vitamins', days_of_week: everyDay, time_of_day: 'morning' }, 0);

    await expect(updateRoutine(phone, pills.id, { title: '   ', days_of_week: everyDay, time_of_day: 'evening' })).rejects.toMatchObject({ code: '23514' });
    await expect(updateRoutine(phone, pills.id, { title: 'Vitamins', days_of_week: 0, time_of_day: 'evening' })).rejects.toMatchObject({ code: '23514' });
    expect(await loadRoutines(phone)).toEqual([pills]);
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
    const hijack = { title: 'Hijacked', days_of_week: 1, time_of_day: 'evening' } as const;

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
    await expect(updateRoutine(wall, pills.id, { title: 'Renamed', days_of_week: 1, time_of_day: 'evening' })).rejects.toBeTruthy();
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
    await expect(updateRoutine(tablet.client, pills.id, { title: 'Hijacked', days_of_week: 1, time_of_day: 'evening' })).rejects.toBeTruthy();
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
    const yesterday = householdDay(arranged.household.timezone, new Date(Date.now() - 24 * 60 * 60 * 1000)).date;
    expect(yesterday).not.toBe(today);

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
    const yesterday = householdDay(arranged.household.timezone, new Date(Date.now() - 24 * 60 * 60 * 1000)).date;
    const tomorrow = householdDay(arranged.household.timezone, new Date(Date.now() + 24 * 60 * 60 * 1000)).date;

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
    await expect(updateRoutine(visitor, pills.id, { title: 'Hijacked', days_of_week: 1, time_of_day: 'evening' })).rejects.toBeTruthy();
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
