import type { EventForm } from './native-events';

// The time sheet's core (docs/specs/0013, The time sheet): no DOM, so the sheet is a thin skin over rules tested on their own.
// Times are 'HH:MM' on the Household's wall clock, as the Add event form holds them. An event ends on its own day, so the last
// time is 23:59.

export type Meridiem = 'AM' | 'PM';
export type Drum = { hour: number; minute: number; meridiem: Meridiem };

export const LAST_MINUTE = 23 * 60 + 59;
export const NO_LATER_END = 'The event must end after it starts.';

// Minutes into the day for an 'HH:MM', or null when it is not one.
export function minutesOf(time: string): number | null {
  const found = /^(\d{2}):(\d{2})$/.exec(time);
  return found ? Number(found[1]) * 60 + Number(found[2]) : null;
}

export const timeOf = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

// A time as someone types it: "4", "4:30", "430", "1630", "16:30", "4pm", "4:30 pm", "4.30", "4 30". With AM or PM the hour is 1 to
// 12 ("12am" is midnight, "12pm" noon). Without, 1 to 11 take `current`, the field's meridiem as it stands, 13 to 23 are themselves,
// and "12" is noon whatever the meridiem is. Anything else is null.
export function parseTypedTime(text: string, current: Meridiem): string | null {
  const found = /^(?:(\d{1,2})[:.\s](\d{2})|(\d{1,4}))\s*(am|pm|a|p)?$/.exec(text.trim().toLowerCase());
  if (!found) return null;
  let hour: number;
  let minute: number;
  if (found[3] !== undefined) {
    // Digits alone: one or two are an hour, three or four an hour and two digits of minutes.
    const digits = found[3];
    hour = Number(digits.length > 2 ? digits.slice(0, -2) : digits);
    minute = digits.length > 2 ? Number(digits.slice(-2)) : 0;
  } else {
    hour = Number(found[1]);
    minute = Number(found[2]);
  }
  if (hour > 23 || minute > 59) return null;
  const said = found[4]?.startsWith('a') ? 'AM' : found[4] ? 'PM' : undefined;
  if (said) {
    if (hour < 1 || hour > 12) return null;
    return timeOfDrum({ hour, minute, meridiem: said });
  }
  // 0 and 13 to 23 are the 24-hour clock's own; 12 is noon.
  return timeOf((hour >= 1 && hour <= 11 && current === 'PM' ? hour + 12 : hour) * 60 + minute);
}

// What the drums show for a time: the hour 1 to 12, the minute at or below it in fives, and AM or PM.
export function drumOf(time: string): Drum {
  const minutes = minutesOf(time) ?? 0;
  const hour24 = Math.floor(minutes / 60);
  return { hour: hour24 % 12 || 12, minute: minutes % 60 - (minutes % 5), meridiem: hour24 >= 12 ? 'PM' : 'AM' };
}

export function timeOfDrum({ hour, minute, meridiem }: Drum): string {
  return timeOf(((hour % 12) + (meridiem === 'PM' ? 12 : 0)) * 60 + minute);
}

// Starts moved to `time`, and Ends with it, so the event keeps its length (an hour when it had none), as far as the day lets it: the
// end stops at 23:59, and a start is held at 23:58 so that there is always an end after it.
export function setStart(form: EventForm, time: string): EventForm {
  const start = minutesOf(form.startTime);
  const end = minutesOf(form.endTime);
  const next = minutesOf(time);
  if (start === null || end === null || next === null) return form;
  const first = Math.min(next, LAST_MINUTE - 1);
  const length = end > start ? end - start : 60;
  return { ...form, startTime: timeOf(first), endTime: timeOf(Math.min(first + length, LAST_MINUTE)) };
}

// Ends moved to `time` on its own, or the words that say why not: it must be after Starts.
export function setEnd(form: EventForm, time: string): EventForm | { problem: string } {
  const start = minutesOf(form.startTime);
  const end = minutesOf(time);
  if (start === null || end === null) return form;
  return end <= start ? { problem: NO_LATER_END } : { ...form, endTime: time };
}
