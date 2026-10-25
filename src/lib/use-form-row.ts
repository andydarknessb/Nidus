import { useState } from 'react';
import type { CardWriteOutcome, ChangeThen, useChange } from './change';
import { askRow, CLOSED_ROW, nameGiven, rowProblem, startRow, type FormRowState } from './form-row';
import type { Named, Said } from './write-failure';

// The form row's hook (form-row.ts has the state and the words): which row a form is open for, the name it was asked for, and the
// one call a form makes to save. `place` names where a write's failure is said (a field's, a row's, or the page's line); `opener`
// is the control focus returns to when the row closes. A form that is always on the page passes `initially` and never closes.

export type FormRowRead<T> = Pick<ReturnType<typeof useChange<T>>, 'change' | 'focus' | 'busy' | 'isBusy' | 'problem'>;

export function useFormRow<T>({
  what,
  place,
  read,
  opener,
  initially,
}: {
  // The thing the form asks a name for, or none for a form that asks for no name.
  what?: Named | undefined;
  // Where a write's failure is said, for the row open now.
  place: (id: string) => string;
  read: FormRowRead<T>;
  // Where focus goes when the row closes.
  opener: (id: string) => string;
  // The row an always-on form starts open as; a row that swaps in starts closed.
  initially?: string | undefined;
}) {
  const [row, setRow] = useState<FormRowState>(() => (initially === undefined ? CLOSED_ROW : startRow(initially)));

  // What the form says of its name, in its own line.
  const nameProblem = (name: string): Said | null => (what === undefined ? null : rowProblem(row, what, name));

  // Opens a row, and closes it: focus goes back to the control that opened it.
  const start = (id: string) => setRow(startRow(id));
  const close = () => {
    if (row.id !== null) read.focus(opener(row.id));
    setRow(CLOSED_ROW);
  };
  // Starts an always-on form again, with the next ask the first.
  const reset = () => {
    if (row.id !== null) setRow(startRow(row.id));
  };

  // The one call a form makes to save. A name that is not there counts an ask and says so, in the form's own line; a form that asks
  // for no name passes null. Otherwise the write goes through the change at its place, and `then` says what the page does once it
  // landed. `asked` is not a write, and `busy` is the change's.
  async function submit<R>(name: string | null, work: () => Promise<R>, then?: ChangeThen<R, T>): Promise<CardWriteOutcome | 'asked'> {
    if (name !== null && !nameGiven(name)) {
      setRow((was) => askRow(was));
      return 'asked';
    }
    if (row.id === null) return 'busy';
    return read.change(place(row.id), work, then);
  }

  return { row, open: row.id, start, close, reset, submit, nameProblem, busy: read.busy, isBusy: read.isBusy, focus: read.focus };
}
