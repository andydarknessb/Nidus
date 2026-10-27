import type { Occurrence } from './calendar-occurrences';
import type { EventForm, NativeEventInput, Repeat } from './native-events';
import { WEEKDAYS } from './routines';
import { LAST_MINUTE, NO_LATER_END, minutesOf, timeInputWords, timeOf } from './time-picker';
import { addDays, dayStartMs, householdDay, instantAt } from '@shared/zoned-time.ts';

// The event draft (docs/specs/0015, "1. The event draft"): the Native Event form's rules in one place. An immutable value and pure
// transitions over it, with no screen and no database: the sheet draws it, `useEventDraft` keeps it, and `runPlan`
// (native-events.ts) writes the plan it comes to. A move that changes nothing returns the same draft, which is how a caller tells a
// real change. Times are 'HH:MM' on the Household's wall clock and dates are Household dates; turning them into instants uses the
// Household Timezone, so a tablet or phone in another zone writes the same event.

// What is to be written, named for the write, with what that write needs and nothing the screen holds.
export type Plan =
  | { kind: 'add'; input: NativeEventInput }
  | { kind: 'save'; input: NativeEventInput; occurrence: Occurrence }
  // "This one" and "every one" are of an Occurrence of a Repeat; the form is written once the plan runs.
  | { kind: 'save-one'; form: EventForm; occurrence: Occurrence }
  | { kind: 'save-every'; form: EventForm; occurrence: Occurrence }
  | { kind: 'skip'; occurrence: Occurrence }
  | { kind: 'delete'; occurrence: Occurrence };

// The footer's question: whether to delete, or, for an Occurrence of a Repeat, which of "this one" and "every one" to save.
export type Question = 'delete' | 'save';

export type EventDraft = {
  readonly form: EventForm;
  // The form as it opened: what "nothing has been typed or changed" is measured against.
  readonly opened: EventForm;
  // Once a time has been set the times stay when the day changes; so they do, always, for an event being edited.
  readonly keepTimes: boolean;
  // "Another day" is a choice of its own, not what the date happens to be: a date picked in its field that is also today or one of
  // the next two must not take the field away from under the finger.
  readonly another: boolean;
  readonly asking: Question | null;
  // The Occurrence being edited, if any.
  readonly occurrence: Occurrence | undefined;
  readonly timezone: string;
};

// ---- Opening ---------------------------------------------------------------------------

export function blankEventForm(date: string): EventForm {
  return { title: '', date, allDay: false, startTime: '09:00', endTime: '10:00', location: '', notes: '', profileIds: [], repeat: null };
}

// The Routines' bit for the weekday of a Household date (Sunday = bit 0); 0 for a date that is not one.
function weekdayBit(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return Number.isNaN(day) ? 0 : 1 << day;
}

function clock(ms: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${part('hour')}:${part('minute')}`;
}

const HOUR_MS = 60 * 60 * 1000;

// The times a new event on `date` opens with. When `date` is today in the Household Timezone, the next whole hour for an
// hour; on any other day, 9:00 AM to 10:00 AM. The hour comes from the instant: `now` moved on to the start of the next hour
// on the Household's clock, then read there, never from adding to a time written as text, so the night the clocks go
// forward cannot give a time that does not exist. It stays inside the day: Starts is 11:00 PM at the latest, and Ends is an
// hour after it or 11:45 PM, whichever comes first.
function openingTimes(date: string, timezone: string, now: Date): { startTime: string; endTime: string } {
  if (householdDay(timezone, now).date !== date) return { startTime: '09:00', endTime: '10:00' };
  // How far into its hour `now` is on the Household's clock. Every zone is a whole number of minutes from UTC, so the
  // seconds and milliseconds are UTC's.
  const intoHour = (Number(clock(now.getTime(), timezone).slice(3)) * 60 + now.getUTCSeconds()) * 1000 + now.getUTCMilliseconds();
  const startsAt = now.getTime() - intoHour + HOUR_MS;
  // `at` as the Household's clock reads it while that is still today and before `last`; otherwise `last`.
  const readOr = (at: number, last: string) => (householdDay(timezone, new Date(at)).date === date && clock(at, timezone) < last ? clock(at, timezone) : last);
  return { startTime: readOr(startsAt, '23:00'), endTime: readOr(startsAt + HOUR_MS, '23:45') };
}

// The form an existing Native Event opens with, as the Household's wall clock reads it.
function eventFormFromOccurrence(occurrence: Occurrence, timezone: string): EventForm {
  const start = Date.parse(occurrence.starts_at);
  const blank = blankEventForm(householdDay(timezone, new Date(start)).date);
  return {
    ...blank,
    title: occurrence.title,
    allDay: occurrence.is_all_day,
    ...(occurrence.is_all_day ? {} : { startTime: clock(start, timezone), endTime: clock(Date.parse(occurrence.ends_at), timezone) }),
    location: occurrence.location ?? '',
    notes: occurrence.description ?? '',
    profileIds: occurrence.profile_ids,
    repeat: occurrence.repeat_every ? { every: occurrence.repeat_every, interval: occurrence.repeat_interval ?? 1, days: occurrence.repeat_days ?? 0, until: occurrence.repeat_until } : null,
  };
}

// A new Native Event on a Household date (it opens at the opening times: the next whole hour for today, 9:00 AM for another day), or
// the edit of an Occurrence (whose times always stay).
export function openDraft(from: { date: string } | { occurrence: Occurrence }, timezone: string, now: Date = new Date()): EventDraft {
  const occurrence = 'occurrence' in from ? from.occurrence : undefined;
  const form = 'occurrence' in from ? eventFormFromOccurrence(from.occurrence, timezone) : { ...blankEventForm(from.date), ...openingTimes(from.date, timezone, now) };
  const today = householdDay(timezone, now).date;
  return { form, opened: form, keepTimes: occurrence !== undefined, another: !dayChoices(today).some((day) => day.date === form.date), asking: null, occurrence, timezone };
}

// ---- The form's rules -------------------------------------------------------------------

// The form with its date moved to `date`. A new event whose times no one has set takes that day's opening times (today at the next
// whole hour, any other day at 9:00 AM); once a time has been set, and always for an event being edited (`keepTimes`), they stay as they
// are. A week Repeat that has only the old date's weekday pressed moves its day with the date. (`runPlan` moves "every one" the same way.)
export function moveToDay(form: EventForm, date: string, keepTimes: boolean, timezone: string, now: Date = new Date()): EventForm {
  const { repeat } = form;
  const follows = repeat?.every === 'week' && repeat.days === weekdayBit(form.date) && weekdayBit(date) !== 0;
  return { ...form, date, ...(follows ? { repeat: { ...repeat, days: weekdayBit(date) } } : {}), ...(keepTimes ? {} : openingTimes(date, timezone, now)) };
}

// Whether nothing has been typed or changed since the form `opened`: the one question that decides whether a tap outside the sheet may
// close it. The same people pressed in another order are the same people.
function sameForm(form: EventForm, opened: EventForm): boolean {
  const { profileIds, repeat, ...fields } = form;
  const { profileIds: openedIds, repeat: openedRepeat, ...openedFields } = opened;
  // The Repeat is an object: the same Repeat is one with the same fields.
  const sameRepeat = repeat === openedRepeat || (repeat !== null && openedRepeat !== null && (Object.keys(repeat) as (keyof Repeat)[]).every((key) => repeat[key] === openedRepeat[key]));
  return (
    sameRepeat &&
    (Object.keys(fields) as (keyof typeof fields)[]).every((key) => fields[key] === openedFields[key]) &&
    profileIds.length === openedIds.length &&
    profileIds.every((id) => openedIds.includes(id))
  );
}

export const untouched = (draft: EventDraft): boolean => sameForm(draft.form, draft.opened);

export function eventFormToInput(form: EventForm, timezone: string): NativeEventInput | { problem: string } {
  const title = form.title.trim();
  if (title === '') return { problem: 'Give the event a title.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date) || addDays(form.date, 0) !== form.date) return { problem: 'Pick a date.' };
  const repeat = form.repeat;
  if (repeat) {
    if (!Number.isInteger(repeat.interval) || repeat.interval < 1 || repeat.interval > 99) return { problem: 'Repeat every 1 to 99.' };
    if (repeat.every === 'week' && (repeat.days & 127) === 0) return { problem: 'Pick at least one day.' };
    if (repeat.until !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(repeat.until) || addDays(repeat.until, 0) !== repeat.until)) return { problem: 'Pick the day the repeat ends.' };
    if (repeat.until !== null && repeat.until < form.date) return { problem: 'The repeat ends before it starts.' };
  }
  let startsAt: number;
  let endsAt: number;
  if (form.allDay) {
    startsAt = dayStartMs(form.date, timezone);
    endsAt = dayStartMs(addDays(form.date, 1), timezone);
  } else {
    if (!/^\d{2}:\d{2}$/.test(form.startTime) || !/^\d{2}:\d{2}$/.test(form.endTime)) {
      return { problem: 'Pick a start and end time, or choose all day.' };
    }
    startsAt = instantAt(form.date, form.startTime, timezone);
    endsAt = instantAt(form.date, form.endTime, timezone);
    if (endsAt <= startsAt) {
      // An end after its start on the clock can still be at or before it here: a time inside the hour the clocks skip does
      // not exist, and moves on by the hour (wallMs). Say which time that is, not that the end is before the start.
      const skipped = form.endTime > form.startTime ? [form.startTime, form.endTime].find((time) => clock(instantAt(form.date, time, timezone), timezone) !== time) : undefined;
      return { problem: skipped ? `The clocks go forward on this day, so there is no ${timeInputWords(skipped)}. Pick another time.` : NO_LATER_END };
    }
  }
  const cleanOptional = (value: string) => value.trim() || null;
  return {
    title,
    location: cleanOptional(form.location),
    notes: cleanOptional(form.notes),
    starts_at: new Date(startsAt).toISOString(),
    ends_at: new Date(endsAt).toISOString(),
    is_all_day: form.allDay,
    profile_ids: form.profileIds,
    repeat_every: repeat?.every ?? null,
    repeat_interval: repeat?.interval ?? 1,
    repeat_days: repeat?.every === 'week' ? repeat.days & 127 : null,
    repeat_until: repeat?.until ?? null,
  };
}

// Starts moved to `time`, and Ends with it, so the event keeps its length (an hour when it had none), as far as the day lets it: the end
// stops at 23:59, and a start is held at 23:58 so that there is always an end after it.
function startAt(form: EventForm, time: string): EventForm {
  const start = minutesOf(form.startTime);
  const end = minutesOf(form.endTime);
  const next = minutesOf(time);
  if (start === null || end === null || next === null) return form;
  const first = Math.min(next, LAST_MINUTE - 1);
  const length = end > start ? end - start : 60;
  return { ...form, startTime: timeOf(first), endTime: timeOf(Math.min(first + length, LAST_MINUTE)) };
}

// Ends moved to `time` on its own, or the words that say why not: it must be after Starts.
function endAt(form: EventForm, time: string): EventForm | { problem: string } {
  const start = minutesOf(form.startTime);
  const end = minutesOf(time);
  if (start === null || end === null) return form;
  return end <= start ? { problem: NO_LATER_END } : { ...form, endTime: time };
}

// The days the sheet offers with one tap, from the Household's `today`: today and the next two ("Today", "Fri 2", "Sat 3"). Any other
// day is "Another day", which shows the date field.
export type DayChoice = { date: string; label: string };

function dayChoices(today: string): DayChoice[] {
  return [0, 1, 2].map((offset) => {
    const date = addDays(today, offset);
    const weekday = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!.short;
    return { date, label: offset === 0 ? 'Today' : `${weekday} ${Number(date.slice(8))}` };
  });
}

// ---- Moves ----------------------------------------------------------------------------------

// `draft` with `patch` on it, or `draft` itself when that changes nothing.
function update(draft: EventDraft, patch: Partial<EventDraft>): EventDraft {
  const changed = (Object.keys(patch) as (keyof EventDraft)[]).some((key) => (key === 'form' ? !sameForm(patch.form!, draft.form) : patch[key] !== draft[key]));
  return changed ? { ...draft, ...patch } : draft;
}

const edit = (draft: EventDraft, changes: Partial<EventForm>): EventDraft => update(draft, { form: { ...draft.form, ...changes } });

// A field typed or switched.
export const setField = (draft: EventDraft, changes: Partial<Pick<EventForm, 'title' | 'allDay' | 'location' | 'notes'>>): EventDraft => edit(draft, changes);

// A day from the row of days: the date moves, and "Another day" is no longer the choice.
export const pickDay = (draft: EventDraft, date: string, now: Date = new Date()): EventDraft =>
  update(draft, { form: moveToDay(draft.form, date, draft.keepTimes, draft.timezone, now), another: false });

// A date typed or picked in the date field "Another day" shows: the field stays.
export const pickDate = (draft: EventDraft, date: string, now: Date = new Date()): EventDraft =>
  update(draft, { form: moveToDay(draft.form, date, draft.keepTimes, draft.timezone, now) });

export const chooseAnotherDay = (draft: EventDraft): EventDraft => update(draft, { another: true });

// The Repeats row. Choosing a shape keeps the number and the end; a week starts with the form's day pressed. `null` is no Repeat.
export function chooseRepeat(draft: EventDraft, every: Repeat['every'] | null): EventDraft {
  const { form } = draft;
  const was = form.repeat;
  if (every === null) return edit(draft, { repeat: null });
  if (was?.every === every) return draft;
  return edit(draft, { repeat: { every, interval: was?.interval ?? 1, days: every === 'week' ? weekdayBit(form.date) : (was?.days ?? 0), until: was?.until ?? null } });
}

// The Repeat's number, days or end.
export function changeRepeat(draft: EventDraft, changes: Partial<Repeat>): EventDraft {
  const { repeat } = draft.form;
  return repeat ? edit(draft, { repeat: { ...repeat, ...changes } }) : draft;
}

// Everyone is nobody pressed: pressing a person lets Everyone go, pressing Everyone lets every person go.
export const pressPerson = (draft: EventDraft, id: string): EventDraft =>
  edit(draft, { profileIds: draft.form.profileIds.includes(id) ? draft.form.profileIds.filter((other) => other !== id) : [...draft.form.profileIds, id] });

export const pressEveryone = (draft: EventDraft): EventDraft => (draft.form.profileIds.length === 0 ? draft : edit(draft, { profileIds: [] }));

// The time sheet's Done: Starts takes Ends with it, and an Ends that is not after Starts is refused, in words the time sheet says.
export function setTime(draft: EventDraft, which: 'start' | 'end', time: string): EventDraft | { problem: string } {
  const form = which === 'start' ? startAt(draft.form, time) : endAt(draft.form, time);
  return 'problem' in form ? form : update(draft, { form, keepTimes: true });
}

// ---- Submit, the question and the answer ----------------------------------------------------

// A problem in the form's words; or, for an Occurrence of a Repeat, the draft now asking which of its events is meant before
// anything is written; or what to write.
export function submit(draft: EventDraft): { problem: string } | { draft: EventDraft } | { plan: Plan } {
  const input = eventFormToInput(draft.form, draft.timezone);
  if ('problem' in input) return input;
  const { occurrence } = draft;
  if (occurrence?.repeat_every != null) return { draft: update(draft, { asking: 'save' }) };
  return { plan: occurrence ? { kind: 'save', input, occurrence } : { kind: 'add', input } };
}

export const askToDelete = (draft: EventDraft): EventDraft => (draft.occurrence ? update(draft, { asking: 'delete' }) : draft);

export const goBack = (draft: EventDraft): EventDraft => update(draft, { asking: null });

// A write that failed takes the question away, so the form's foot can say why.
export const writeFailed = goBack;

// "This one" or "every one" to the question asked. An event that does not repeat has one Delete button, which answers "every". Nothing
// is asked, nothing is planned.
export function answer(draft: EventDraft, which: 'one' | 'every'): Plan | null {
  const { occurrence, asking, form } = draft;
  if (!occurrence || !asking) return null;
  if (asking === 'save') return { kind: which === 'one' ? 'save-one' : 'save-every', form, occurrence };
  return { kind: which === 'one' ? 'skip' : 'delete', occurrence };
}

// The row of days: what one tap offers from the Household's `today`, and whether "Another day" is the choice.
export const dayRow = (draft: EventDraft, today: string): { days: DayChoice[]; another: boolean } => ({ days: dayChoices(today), another: draft.another });
