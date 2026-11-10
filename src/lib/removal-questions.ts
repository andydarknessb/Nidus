import { timeWord } from './routine-chart';
import type { Routine } from './routines';

// The words of the questions before something is removed that a page asks as a Confirm (components/phone.tsx): the title, what goes,
// and the two answers. They live here, not in the page, so the phone's cases can say them without drawing a page.

// What a Routine's buttons are called: its title, then its time of day when it has one, so two Routines with one title (Brush teeth
// in the morning and again in the evening) can be told apart.
export function routineName(routine: Routine): string {
  const time = timeWord(routine.time_of_day);
  return time ? `${routine.title}, ${time}` : routine.title;
}

// Before a Routine is archived: it comes off its person's chart, and the days already ticked are kept.
export function archiveQuestion(routine: Routine, person: string) {
  const name = routineName(routine);
  return {
    title: `Archive ${name}?`,
    words: `It comes off ${person}'s chart and can't be brought back. Days already ticked are kept.`,
    cancel: 'Keep it',
    confirm: `Archive ${name}`,
  };
}

// Before a Shared List is deleted: its items go with it.
export function deleteListQuestion(name: string) {
  return {
    title: `Delete ${name}?`,
    words: "Its items go with it, and it can't be brought back.",
    cancel: 'Keep it',
    confirm: `Delete ${name} and its items`,
  };
}
