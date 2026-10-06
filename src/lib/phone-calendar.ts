import { describePage, pageStart, type Occurrence, type WallDay } from './calendar-occurrences';
import type { Profile } from './profiles';
import { householdDay } from './routines';
import { pillPeople } from './schedule';

// What the phone's Calendar decides apart from what it draws (docs/specs/0004-the-wall-on-a-phone.md; docs/look.md, "The phone"):
// the day Week and Month start on, and the dots of a Month cell. Both are pure, so they are tested without a screen
// (tests/phone-calendar.test.ts). Every date is a Household date, and today is read in the Household Timezone: nothing reads the
// machine's zone.

// The day a Week or Month page starts on picked: today when the page holds it, else its first day (the Sunday of a week, the 1st of a
// month). `anchor` is any date of the page. A month holds today only when today is in that month, not when it shows it as a dimmed
// day of a neighbouring week (pageStart, as holdsToday in calendar-occurrences.ts reads it). The screen keeps the pick as its own
// state and gives it up when the page changes.
export function pickedDay(view: 'week' | 'month', anchor: string, timezone: string, now: Date): string {
  const first = pageStart(view, anchor);
  const today = householdDay(timezone, now).date;
  return pageStart(view, today) === first ? today : first;
}

// A Month cell has room for this many dots.
export const MAX_DOTS = 3;

// One dot of a Month cell: the whole Household's (drawn in --primary) or one person's (in their strong colour).
export type MonthDot = { kind: 'household' } | { kind: 'person'; profile: Profile };

// The dots of a day, from its `occurrences` (after the Profile filter) and the Household's `profiles`: the whole Household's first, if
// anything on the day is for it, then each person who has something, once, in the Profiles' own order, which is the people strip's,
// and never more than MAX_DOTS (the cell's name carries how many events there are). Who an event is for is the pill's rule
// (pillPeople): no Profile, or every Profile of a Household of two or more, is the whole Household's. `pressed` are the Profiles
// the filter lets through (none pressed: everyone): an event for Ava and Ben that is on the day because Ava is pressed gives Ava's
// dot and not Ben's.
export function monthDots(occurrences: readonly Occurrence[], profiles: readonly Profile[], pressed: readonly string[] = []): MonthDot[] {
  let household = false;
  const people = new Set<string>();
  for (const occurrence of occurrences) {
    if (pillPeople(occurrence, profiles).kind === 'everyone') {
      household = true;
      continue;
    }
    for (const id of occurrence.profile_ids) if (pressed.length === 0 || pressed.includes(id)) people.add(id);
  }
  const dots: MonthDot[] = household ? [{ kind: 'household' }] : [];
  for (const profile of profiles) if (people.has(profile.id)) dots.push({ kind: 'person', profile });
  return dots.slice(0, MAX_DOTS);
}

// The pager's words for a Day or Week page, short enough for a phone's 22 px line between its two buttons: "Wed, Sep 30" for a day and
// "Oct 4 to Oct 10" for a week, with the year ("Wed, Sep 30, 2027") only when the page is not in the Household's current year, `today`'s.
// (The tablet's title always has it: describePage.)
export function pageWords(days: readonly WallDay[], today: string): string {
  const year = days[0]!.date.slice(0, 4);
  const words = describePage([...days]);
  const yearly = year !== today.slice(0, 4) || days[days.length - 1]!.date.slice(0, 4) !== today.slice(0, 4);
  if (yearly) return words;
  // "Wed, Sep 30, 2026" and "Oct 4 to Oct 10, 2026" without the year they end in.
  return words.replace(/, \d{4}$/, '');
}
