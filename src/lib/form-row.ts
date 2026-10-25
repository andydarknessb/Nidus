import { unnamed, type Named, type Said } from './write-failure';

// The form row (spec 0014): the lifecycle of a form that takes a place on a page, whether it is a row that swaps in for another
// (Rename, Edit) or a form that is always on the page (New list, Add person, the iPhone link). The core holds which row the form
// is for and how many times it has been asked to save with no name; the words for a name that is not there are write-failure's.
// Pure, so a test needs no screen. use-form-row.ts is its hook.

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
