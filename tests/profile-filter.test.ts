import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Occurrence } from '../src/lib/calendar-occurrences';
import { createProfileFilter, filterOccurrences, prunePressed } from '../src/lib/profile-filter';

// The Profile filter: which occurrences the pressed Profiles keep, which pressed ids survive a
// Profile being deleted, and the state holder that clears itself two minutes after the last tap.
// The clock is faked: nothing here waits for a real one.

// An occurrence attributed to `profileIds`; none means the whole Household.
function occurrence(id: string, profileIds: string[]): Occurrence {
  return {
    source: 'synced',
    id,
    calendar_id: null,
    calendar_name: 'Calendar',
    title: id,
    description: null,
    location: null,
    starts_at: '2026-10-05T17:00:00Z',
    ends_at: '2026-10-05T18:00:00Z',
    is_all_day: false,
    profile_id: profileIds[0] ?? null,
    color: null,
    profile_ids: profileIds,
    colors: [],
  };
}

const ids = (occurrences: Occurrence[]) => occurrences.map((each) => each.id);

describe('filterOccurrences', () => {
  const everything = [
    occurrence('ada', ['ada']),
    occurrence('ben', ['ben']),
    occurrence('cy', ['cy']),
    occurrence('ada-and-ben', ['ada', 'ben']),
    occurrence('household', []),
  ];

  it('shows everything when nothing is pressed', () => {
    expect(ids(filterOccurrences(everything, []))).toEqual(['ada', 'ben', 'cy', 'ada-and-ben', 'household']);
  });

  it('keeps one pressed Profile’s occurrences and the whole Household’s', () => {
    expect(ids(filterOccurrences(everything, ['ben']))).toEqual(['ben', 'ada-and-ben', 'household']);
  });

  it('keeps the occurrences of every pressed Profile, in their order', () => {
    expect(ids(filterOccurrences(everything, ['cy', 'ada']))).toEqual(['ada', 'cy', 'ada-and-ben', 'household']);
  });

  it('keeps an occurrence for two Profiles when only one of them is pressed', () => {
    expect(ids(filterOccurrences(everything, ['ada']))).toContain('ada-and-ben');
    expect(ids(filterOccurrences(everything, ['ben']))).toContain('ada-and-ben');
    expect(ids(filterOccurrences(everything, ['cy']))).not.toContain('ada-and-ben');
  });

  it('always keeps a whole-Household occurrence', () => {
    for (const pressed of [['ada'], ['ben', 'cy'], ['ada', 'ben', 'cy']]) {
      expect(ids(filterOccurrences(everything, pressed))).toContain('household');
    }
  });

  it('keeps only the whole Household’s when a pressed id matches nothing', () => {
    expect(ids(filterOccurrences(everything, ['deleted']))).toEqual(['household']);
  });
});

describe('prunePressed', () => {
  it('drops the ids of Profiles that no longer exist and keeps the order of the rest', () => {
    expect(prunePressed(['cy', 'deleted', 'ada'], [{ id: 'ada' }, { id: 'ben' }, { id: 'cy' }])).toEqual(['cy', 'ada']);
  });

  it('keeps every id when every Profile still exists', () => {
    expect(prunePressed(['ben', 'ada'], [{ id: 'ada' }, { id: 'ben' }])).toEqual(['ben', 'ada']);
  });

  it('leaves nothing pressed when nothing was, or when no Profile is left', () => {
    expect(prunePressed([], [{ id: 'ada' }])).toEqual([]);
    expect(prunePressed(['ada', 'ben'], [])).toEqual([]);
  });
});

describe('createProfileFilter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with nothing pressed and presses and lets go of Profiles in the order tapped', () => {
    const filter = createProfileFilter();
    expect(filter.pressed()).toEqual([]);
    filter.toggle('ben');
    filter.toggle('ada');
    expect(filter.pressed()).toEqual(['ben', 'ada']);
    filter.toggle('ben');
    expect(filter.pressed()).toEqual(['ada']);
    filter.dispose();
  });

  it('clears itself two minutes after the last tap', () => {
    const filter = createProfileFilter();
    filter.toggle('ada');
    vi.advanceTimersByTime(2 * 60_000 - 1);
    expect(filter.pressed()).toEqual(['ada']);
    vi.advanceTimersByTime(1);
    expect(filter.pressed()).toEqual([]);
  });

  it('starts the two minutes again at each tap', () => {
    const filter = createProfileFilter();
    filter.toggle('ada');
    // 1:59 in, a second tap: the wait starts over from here, not from the first tap.
    vi.advanceTimersByTime(119_000);
    filter.toggle('ben');
    vi.advanceTimersByTime(119_000);
    expect(filter.pressed()).toEqual(['ada', 'ben']);
    vi.advanceTimersByTime(1_000);
    expect(filter.pressed()).toEqual([]);
  });

  it('leaves no timer running once the last pressed Profile is let go', () => {
    const filter = createProfileFilter();
    filter.toggle('ada');
    filter.toggle('ben');
    filter.toggle('ada');
    expect(vi.getTimerCount()).toBe(1);
    filter.toggle('ben');
    expect(filter.pressed()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops its timer when cleared', () => {
    const filter = createProfileFilter();
    filter.toggle('ada');
    filter.clear();
    expect(filter.pressed()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops its timer when disposed, and clears nothing afterwards', () => {
    const filter = createProfileFilter();
    filter.toggle('ada');
    filter.dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10 * 60_000);
    expect(filter.pressed()).toEqual(['ada']);
  });

  it('lets subscribers hear each change once, and only a change', () => {
    const filter = createProfileFilter();
    const heard: string[][] = [];
    const stop = filter.subscribe(() => heard.push([...filter.pressed()]));

    filter.toggle('ada');
    filter.toggle('ben');
    filter.toggle('ada');
    filter.clear();
    // Nothing is pressed, so there is nothing to clear and nothing to hear.
    filter.clear();
    filter.toggle('cy');
    // A prune that drops nothing changes nothing.
    filter.prune([{ id: 'cy' }]);
    vi.advanceTimersByTime(2 * 60_000);
    expect(heard).toEqual([['ada'], ['ada', 'ben'], ['ben'], [], ['cy'], []]);

    stop();
    filter.toggle('ada');
    expect(heard).toHaveLength(6);
    filter.dispose();
  });

  it('drops the Profiles that are gone without counting as a tap', () => {
    const filter = createProfileFilter();
    filter.toggle('ada');
    filter.toggle('ben');
    vi.advanceTimersByTime(60_000);
    filter.prune([{ id: 'ada' }, { id: 'cy' }]);
    expect(filter.pressed()).toEqual(['ada']);
    // Two minutes after the last tap, not after the prune.
    vi.advanceTimersByTime(60_000);
    expect(filter.pressed()).toEqual([]);
  });

  it('stops its timer when pruning leaves nothing pressed', () => {
    const filter = createProfileFilter();
    filter.toggle('ada');
    filter.prune([]);
    expect(filter.pressed()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
