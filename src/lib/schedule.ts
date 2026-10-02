import { dayOccurrences, describeCell, formatClock, type Occurrence, type WallDay } from './calendar-occurrences';
import type { Profile } from './profiles';
import { routineProgress, WEEKDAYS, type ProfileRoutines } from './routines';

// The schedule (docs/look.md, The parts): Home and Week draw each day as a column of event pills, and the people strip
// above them shows each person's Routines. Everything they decide is here and pure, so it is tested without a screen
// (tests/schedule.test.ts): which pills a day lists and what each says under its title, which one is on now, which a
// column shows, who a pill is for, and the words on the strip. Every date is read in the Household Timezone, which a
// WallDay carries; nothing reads the machine's.

// ---- The columns -----------------------------------------------------------------------------------

// One event on one day: what the pill says under its title, whether it is the one on now, and in today's column when it
// ended, if it has: a pill that is over gives way first when the column is full.
export type Pill = { occurrence: Occurrence; time: string; onNow: boolean; endedAt: number | null };

export type ScheduleColumn = { day: WallDay; pills: Pill[] };

// Whether a pill on `day` says "All day": an all-day event, or a timed event that covers the day from end to end.
export function saysAllDay(occurrence: Occurrence, day: WallDay): boolean {
  return occurrence.is_all_day || (Date.parse(occurrence.starts_at) <= day.startMs && Date.parse(occurrence.ends_at) >= day.endMs);
}

// What a pill says under its title on `day`: "All day" on each day an all-day event covers and on a day a timed event
// covers from end to end; "Until 2:00 AM" on the last day of a timed event that began on an earlier one; otherwise the
// start time, "9:00 AM". It reads the event's real span, as the month's cells do, never the padding the hour grid gives
// a short event.
export function pillTime(occurrence: Occurrence, day: WallDay): string {
  if (saysAllDay(occurrence, day)) return 'All day';
  const start = Date.parse(occurrence.starts_at);
  if (start < day.startMs) return `Until ${formatClock(Date.parse(occurrence.ends_at), day.timezone)}`;
  return formatClock(start, day.timezone);
}

// Whether the pill of `occurrence` on `day` is the one that is on now: a timed event that has started and not ended, in
// today's column. A timed event that runs on past midnight is on now in today's column only. A pill that says "All day"
// never is, a timed event that covers all of today included: it is not saying when, so there is nothing to ring.
export function isOnNow(occurrence: Occurrence, day: WallDay, now: Date): boolean {
  if (!day.isToday || saysAllDay(occurrence, day)) return false;
  const at = now.getTime();
  return Date.parse(occurrence.starts_at) <= at && at < Date.parse(occurrence.ends_at);
}

// When the pill of `occurrence` on `day` ended, if it has: the end of a timed event that is over, in today's column only. An
// all-day event, a timed event that covers all of today (its pill says "All day") and anything in another day's column has
// not ended, however long ago it was over: only today has a column to put in order of what is happening.
export function whenEnded(occurrence: Occurrence, day: WallDay, now: Date): number | null {
  if (!day.isToday || saysAllDay(occurrence, day)) return null;
  const end = Date.parse(occurrence.ends_at);
  return end <= now.getTime() ? end : null;
}

// A column for each of `days`: the occurrences on that day, all-day first, then by start, then by title
// (dayOccurrences, which the month's cells use), each with the words under its title. The Profile filter has been
// applied to `occurrences` already, where they are read.
export function scheduleColumns(occurrences: Occurrence[], days: WallDay[], now: Date): ScheduleColumn[] {
  return days.map((day) => ({
    day,
    pills: dayOccurrences(occurrences, day).map((occurrence) => ({
      occurrence,
      time: pillTime(occurrence, day),
      onNow: isOnNow(occurrence, day, now),
      endedAt: whenEnded(occurrence, day, now),
    })),
  }));
}

// ---- A day's heading -------------------------------------------------------------------------------

// What a day's heading says on its face, over the date: "Today", or the weekday in three letters, "Fri".
export function headingLabel(day: WallDay): string {
  return day.isToday ? 'Today' : WEEKDAYS[day.weekday]!.short;
}

// What the heading's button is called: what is drawn on it, then "open day", so that a name spoken from the screen ("Fri 2")
// finds it. "Friday, October 2, open day" does not contain what is drawn.
export function dayHeadingName(day: WallDay): string {
  return `${headingLabel(day)} ${Number(day.date.slice(8))}, open day`;
}

// ---- Which pills show ------------------------------------------------------------------------------

// Which of a column's pills to draw, a flag for each in order. The pills, in order, and then the "+N more" button stack in a
// column `heightPx` tall with `gapPx` between them: every pill when they all fit, and no button; otherwise the button is
// drawn and as many pills as fit above it. `pillPx` are the pills' own heights, measured, so a title of two lines counts for
// what it takes.
//
// In today's column what has ended gives way first (`endedAt` is when each pill ended, null for one that has not, which is
// every pill of any other day). The pills that are not over, all-day ones included, show in order, as many as fit; only
// when every one of them shows do the ones that are over fill what room is left, the one that ended last first, each in its
// own place in the order. So a pill that is on or to come is never left out for one that is over, and an older one that is
// over never takes the place of a later one that did not fit. The measuring is the screen's; this only decides.
export function pillsToShow({
  heightPx,
  pillPx,
  gapPx,
  morePx,
  endedAt = [],
}: {
  heightPx: number;
  pillPx: readonly number[];
  gapPx: number;
  morePx: number;
  endedAt?: readonly (number | null)[];
}): boolean[] {
  const all = pillPx.reduce((sum, px) => sum + px, 0) + gapPx * Math.max(pillPx.length - 1, 0);
  if (all <= heightPx) return pillPx.map(() => true);
  const shown = pillPx.map(() => false);
  // The button first, then each pill with the gap that follows it (the next pill, or the button).
  let used = morePx;
  const take = (index: number): boolean => {
    used += pillPx[index]! + gapPx;
    if (used > heightPx) return false;
    shown[index] = true;
    return true;
  };
  const indices = pillPx.map((_, index) => index);
  for (const index of indices.filter((each) => endedAt[each] == null)) if (!take(index)) return shown;
  const over = indices.filter((each) => endedAt[each] != null).sort((a, b) => endedAt[b]! - endedAt[a]! || b - a);
  for (const index of over) if (!take(index)) break;
  return shown;
}

// ---- Who a pill is for -----------------------------------------------------------------------------

// A pill shows at most this many bands. Its discs are never more than two wide: past this many Profiles it draws the first
// one's disc and a "+N" disc that counts the rest.
const MAX_BANDS = 3;
const MAX_DISCS = 2;

// The whole Household's look (--everyone and the house disc), or the Profiles the pill is for: one equal band for each of
// the first three; a disc for each of one or two Profiles, or for three or more the first one's disc and `more`, the people
// a "+N" disc counts (three people are a disc and "+2"). `names` is everyone, for a screen reader.
export type PillPeople = { kind: 'everyone' } | { kind: 'people'; bands: Profile[]; discs: Profile[]; more: number; names: string[] };

// Who `occurrence` is for, from its `profile_ids` and the Household's Profiles, in the Profiles' own order. The view's
// `color` and `colors` are a Mirrored Calendar's and are never read: a Profile's own colour is drawn from the Profile. An
// event for no Profile, or for none the Household has any more, is the whole Household's, and so is one for every Profile of
// a Household of two or more. In a Household of one Profile an event for that Profile is theirs: there is nobody else for it
// to be shared with, so the whole Household's look is only for an event with no Profile.
export function pillPeople(occurrence: Occurrence, profiles: readonly Profile[]): PillPeople {
  const people = profiles.filter((profile) => occurrence.profile_ids.includes(profile.id));
  if (people.length === 0 || (people.length === profiles.length && profiles.length > 1)) return { kind: 'everyone' };
  const crowded = people.length > MAX_DISCS;
  return {
    kind: 'people',
    bands: people.slice(0, MAX_BANDS),
    discs: crowded ? people.slice(0, 1) : people,
    more: crowded ? people.length - 1 : 0,
    names: people.map((profile) => profile.name),
  };
}

// "Ava", "Ava and Ben", "Cory, Sam and Ava".
export function listNames(names: readonly string[]): string {
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

// What a screen reader hears of a pill: the title, who it is for, the day and the time, then "on now" when it is, and
// "added here" for a Native Event, which lives only in Nidus.
export function pillName(pill: Pill, day: WallDay, people: PillPeople): string {
  const { occurrence } = pill;
  return [
    occurrence.title,
    people.kind === 'everyone' ? 'everyone' : listNames(people.names),
    describeCell(day.date, null),
    pill.time,
    pill.onNow ? 'on now' : '',
    occurrence.source === 'native' ? 'added here' : '',
  ]
    .filter(Boolean)
    .join(', ');
}

// ---- The people strip ------------------------------------------------------------------------------

// One person's pill on the strip: how far through today's Routines, in words ("3 of 5", "All done", or none when there
// are none today), and the name a screen reader hears. The pips are drawn from done and total (and give way to the count
// alone past eight, in the atom).
export type StripPerson = { profile: Profile; done: number; total: number; words: string; label: string };

// A person for every Profile, in the order given, with what they have done of the Routines `groups` hold for today
// (groupByProfile leaves out a Profile with none) out of `doneIds`.
export function stripPeople(profiles: readonly Profile[], groups: readonly ProfileRoutines[], doneIds: ReadonlySet<string>): StripPerson[] {
  return profiles.map((profile) => {
    const group = groups.find((each) => each.profile.id === profile.id);
    const { done, total } = group ? routineProgress(group.routines, doneIds) : { done: 0, total: 0 };
    const words = total === 0 ? '' : done === total ? 'All done' : `${done} of ${total}`;
    // Plain words for the family: "routines" in lower case ("Ava, 3 of 5 routines done"); the glossary's capitals are for code.
    return { profile, done, total, words, label: total === 0 ? profile.name : `${profile.name}, ${done} of ${total} ${total === 1 ? 'routine' : 'routines'} done` };
  });
}
