import { unnamed, type Named, type Said } from './write-failure';

// The form row (spec 0014): the lifecycle of a form that takes a place on a page, whether it is a row that swaps in for another
// (Rename, Edit) or a form that is always on the page (New list, Add person, the iPhone link). The core holds which row the form
// is for and how many times it has been asked to save with no name; the words for a name that is not there are write-failure's.
// A question before something goes is a row with no name (spec 0020): it opens, cancels and dismisses like any row. Pure, so a test
// needs no screen. use-form-row.ts is its hook.

export type FormRowState = {
  // The row the form is for: a row's id, or a name of the form's own ('new', 'pair') for a form that is always on the page. Null
  // when the row is closed.
  id: string | null;
  // How many times the form has been asked to save with no name.
  asked: number;
};

export const CLOSED_ROW: FormRowState = { id: null, asked: 0 };

// Opens the row, or starts an always-on form again: the next ask is the first.
export const startRow = (id: string): FormRowState => ({ id, asked: 0 });

// Counts an ask, so a form asked twice with no name says so twice.
export const askRow = (row: FormRowState): FormRowState => ({ ...row, asked: row.asked + 1 });

// What a form says of its name: nothing before it has been asked, and nothing once a name is there.
export const rowProblem = (row: FormRowState, what: Named, name: string): Said | null => unnamed(what, row.asked, name);

// Whether a save may go: there is a name to check, and it is there.
export const nameGiven = (name: string): boolean => name.trim() !== '';

// What a row does to the card it sits on (change.ts): what was said there is taken away, and focus goes to a control.
export type RowCard = { clear(): void; focus(id: string): void };

// Opens a row. What was said on its card goes first, so a question asked before does not carry its words into this one.
export function openRow(card: Pick<RowCard, 'clear'>, id: string): FormRowState {
  card.clear();
  return startRow(id);
}

// Closes a row by Cancel: what was said goes, and focus goes back to the control that opened the row.
export function cancelRow(card: RowCard, row: FormRowState, opener: (id: string) => string): FormRowState {
  card.clear();
  if (row.id !== null) card.focus(opener(row.id));
  return CLOSED_ROW;
}

// Closes a row once its removal has landed. What was said goes, and focus is not sent back to the control that asked: that control
// is gone with what it removed, and where focus goes is the landing's to say.
export function dismissRow(card: Pick<RowCard, 'clear'>): FormRowState {
  card.clear();
  return CLOSED_ROW;
}
