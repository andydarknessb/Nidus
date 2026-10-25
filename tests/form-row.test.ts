import { describe, expect, it } from 'vitest';
import { askRow, CLOSED_ROW, nameGiven, rowProblem, startRow } from '../src/lib/form-row';
import { giveName } from '../src/lib/write-failure';

// The form row's state (spec 0014): which row is open, and what a form says of a name that is not there. The words are
// write-failure's, so the cases assert that the row counts the asks and hands them on.

describe('the form row', () => {
  it('opens on a row, and starts its asks again', () => {
    const opened = startRow('list-1');
    expect(opened).toEqual({ id: 'list-1', asked: 0 });
    expect(askRow(askRow(opened)).asked).toBe(2);
    expect(startRow('list-1')).toEqual({ id: 'list-1', asked: 0 });
    expect(CLOSED_ROW).toEqual({ id: null, asked: 0 });
  });

  it('says nothing of a name before it has been asked, or once one is there', () => {
    expect(rowProblem(CLOSED_ROW, 'list', '')).toBeNull();
    expect(rowProblem({ id: 'new', asked: 0 }, 'list', 'Groceries')).toBeNull();
    expect(rowProblem({ id: 'new', asked: 1 }, 'list', 'Groceries')).toBeNull();
  });

  it('says the name it wants once it has been asked, and counts each ask', () => {
    const once = askRow({ id: 'new', asked: 0 });
    const twice = askRow(once);
    expect(rowProblem(once, 'list', '  ')).toEqual({ words: giveName('list'), n: 1 });
    expect(rowProblem(twice, 'person', '')).toEqual({ words: giveName('person'), n: 2 });
  });

  it('goes ahead with a name, spaces and all around it counted as a name', () => {
    expect(nameGiven(' Groceries ')).toBe(true);
    expect(nameGiven('')).toBe(false);
    expect(nameGiven('   ')).toBe(false);
  });
});
