import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Occurrence } from '../src/lib/calendar-occurrences';
import { onCalendarScreen, type WallRoute } from '../src/lib/wall-routes';
import { createProfileFilter, filterOccurrences, FILTER_CLEARED_WORDS, prunePressed, sayOnCalendar } from '../src/lib/profile-filter';

// The Profile filter: which occurrences the pressed Profiles keep, which pressed ids survive a
// Profile being deleted, and the state holder that clears itself two minutes after the last touch
// and says so. The clock is faked: nothing here waits for a real one.

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
    profile_ids: profileIds,
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

  // The two minutes are wall-clock time: a tablet that sleeps runs no timers, so it must not wake up
  // filtered. The clock is jumped with setSystemTime, the way watchHouseholdDay is tested.
  it('clears at the next wake-up after the clock jumps past the deadline, however long the tablet slept', () => {
    const filter = createProfileFilter();
    filter.toggle('ada');
    vi.advanceTimersByTime(10_000);
    vi.setSystemTime(Date.now() + 10 * 60_000);
    // The next wake-up is the one a minute after the tap, not the one two minutes after it.
    vi.advanceTimersByTime(49_999);
    expect(filter.pressed()).toEqual(['ada']);
    vi.advanceTimersByTime(1);
    expect(filter.pressed()).toEqual([]);
  });

  it('clears a filter a minute old at the next wake-up after the clock jumps ten minutes', () => {
    const filter = createProfileFilter();
    filter.toggle('ada');
    vi.advanceTimersByTime(60_000);
    expect(filter.pressed()).toEqual(['ada']);
    vi.setSystemTime(Date.now() + 10 * 60_000);
    vi.advanceTimersByTime(60_000);
    expect(filter.pressed()).toEqual([]);
  });

  it('still starts the full two minutes again at a tap after the clock has jumped', () => {
    const filter = createProfileFilter();
    filter.toggle('ada');
    vi.setSystemTime(Date.now() + 10 * 60_000);
    filter.toggle('ben');
    vi.advanceTimersByTime(2 * 60_000 - 1);
    expect(filter.pressed()).toEqual(['ada', 'ben']);
    vi.advanceTimersByTime(1);
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

  // Any touch inside the calendar keeps the filter open, as a tap on a pill does: whoever is reading the calendar is
  // still there.
  it('starts the two minutes again at a touch inside the calendar', () => {
    const filter = createProfileFilter();
    filter.toggle('ada');
    vi.advanceTimersByTime(119_000);
    filter.touch();
    vi.advanceTimersByTime(119_000);
    expect(filter.pressed()).toEqual(['ada']);
    vi.advanceTimersByTime(1_000);
    expect(filter.pressed()).toEqual([]);
  });

  it('keeps the filter open for as long as the calendar is touched, and lets go two minutes after the last touch', () => {
    const filter = createProfileFilter();
    filter.toggle('ada');
    for (let minute = 0; minute < 10; minute++) {
      vi.advanceTimersByTime(60_000);
      filter.touch();
    }
    expect(filter.pressed()).toEqual(['ada']);
    vi.advanceTimersByTime(2 * 60_000 - 1);
    expect(filter.pressed()).toEqual(['ada']);
    vi.advanceTimersByTime(1);
    expect(filter.pressed()).toEqual([]);
  });

  it('starts nothing for a touch while nothing is pressed', () => {
    const filter = createProfileFilter();
    filter.touch();
    expect(vi.getTimerCount()).toBe(0);
    expect(filter.pressed()).toEqual([]);
  });

  it('does not count a touch as a change, so nobody hears it', () => {
    const filter = createProfileFilter();
    filter.toggle('ada');
    let heard = 0;
    filter.subscribe(() => heard++);
    filter.touch();
    filter.touch();
    expect(heard).toBe(0);
    filter.dispose();
  });

  it('starts the full two minutes at a touch after the clock has jumped', () => {
    const filter = createProfileFilter();
    filter.toggle('ada');
    vi.advanceTimersByTime(30_000);
    vi.setSystemTime(Date.now() + 90_000);
    filter.touch();
    vi.advanceTimersByTime(2 * 60_000 - 1);
    expect(filter.pressed()).toEqual(['ada']);
    vi.advanceTimersByTime(1);
    expect(filter.pressed()).toEqual([]);
  });

  describe('saying so', () => {
    it('says its clearing on the status line, once, when the two minutes are up', () => {
      const said: string[] = [];
      const filter = createProfileFilter((words) => said.push(words));
      filter.toggle('ada');
      vi.advanceTimersByTime(2 * 60_000 - 1);
      expect(said).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(said).toEqual([FILTER_CLEARED_WORDS]);
      vi.advanceTimersByTime(10 * 60_000);
      expect(said).toEqual([FILTER_CLEARED_WORDS]);
    });

    it('says it in plain words, with no dash', () => {
      expect(FILTER_CLEARED_WORDS).toBe("Showing everyone's events again");
      expect(FILTER_CLEARED_WORDS).not.toMatch(/[\u2013\u2014]/);
    });

    it('says it after a touch moved the deadline, at the new one', () => {
      const said: string[] = [];
      const filter = createProfileFilter((words) => said.push(words));
      filter.toggle('ada');
      vi.advanceTimersByTime(100_000);
      filter.touch();
      vi.advanceTimersByTime(119_000);
      expect(said).toEqual([]);
      vi.advanceTimersByTime(1_000);
      expect(said).toEqual([FILTER_CLEARED_WORDS]);
    });

    it('says it when the tablet wakes up past the deadline', () => {
      const said: string[] = [];
      const filter = createProfileFilter((words) => said.push(words));
      filter.toggle('ada');
      vi.setSystemTime(Date.now() + 10 * 60_000);
      vi.advanceTimersByTime(60_000);
      expect(filter.pressed()).toEqual([]);
      expect(said).toEqual([FILTER_CLEARED_WORDS]);
    });

    it('says nothing when someone clears it, lets the last Profile go, or a Profile is deleted: they know', () => {
      const said: string[] = [];
      const filter = createProfileFilter((words) => said.push(words));
      filter.toggle('ada');
      filter.clear();
      filter.toggle('ben');
      filter.toggle('ben');
      filter.toggle('cy');
      filter.prune([]);
      vi.advanceTimersByTime(10 * 60_000);
      expect(said).toEqual([]);
    });

    it('says it again for each time it clears itself', () => {
      const said: string[] = [];
      const filter = createProfileFilter((words) => said.push(words));
      filter.toggle('ada');
      vi.advanceTimersByTime(2 * 60_000);
      filter.toggle('ben');
      vi.advanceTimersByTime(2 * 60_000);
      expect(said).toEqual([FILTER_CLEARED_WORDS, FILTER_CLEARED_WORDS]);
    });
  });

  // The filter lives as long as the shell and clears wherever the Wall is, but "Showing everyone's events again" is about events: it is
  // said on the screens that show them (the ones the people strip is on) and on no other.
  describe('saying so, by screen', () => {
    const screens: WallRoute['view'][] = ['home', 'day', 'week', 'month', 'routines', 'meals', 'lists'];
    const calendar: WallRoute['view'][] = ['home', 'day', 'week', 'month'];

    it('counts Home, Day, Week and Month as the calendar screens, and nothing else', () => {
      expect(screens.filter(onCalendarScreen)).toEqual(calendar);
    });

    it('says its clearing on a calendar screen and on no other, and clears on every one', () => {
      for (const view of screens) {
        const said: string[] = [];
        const filter = createProfileFilter(sayOnCalendar((words) => said.push(words), () => view));
        filter.toggle('ada');
        vi.advanceTimersByTime(2 * 60_000);
        expect(filter.pressed(), view).toEqual([]);
        expect(said, view).toEqual(calendar.includes(view) ? [FILTER_CLEARED_WORDS] : []);
        filter.dispose();
      }
    });

    it('looks at the screen the Wall is on when the time is up, not the one the Profile was pressed on', () => {
      let view: WallRoute['view'] = 'home';
      const said: string[] = [];
      const filter = createProfileFilter(sayOnCalendar((words) => said.push(words), () => view));
      filter.toggle('ada');
      vi.advanceTimersByTime(60_000);
      // The Wall moves on to Lists, and the filter clears there with nothing said.
      view = 'lists';
      vi.advanceTimersByTime(60_000);
      expect(filter.pressed()).toEqual([]);
      expect(said).toEqual([]);
      // Pressed again on Home and left on Week, it says it there.
      view = 'home';
      filter.toggle('ben');
      view = 'week';
      vi.advanceTimersByTime(2 * 60_000);
      expect(said).toEqual([FILTER_CLEARED_WORDS]);
    });

    it('says nothing of its own: nothing is said when someone clears it, on any screen', () => {
      const said: string[] = [];
      const filter = createProfileFilter(sayOnCalendar((words) => said.push(words), () => 'home'));
      filter.toggle('ada');
      filter.clear();
      vi.advanceTimersByTime(10 * 60_000);
      expect(said).toEqual([]);
    });
  });
});
