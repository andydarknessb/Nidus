import { describe, expect, it } from 'vitest';
import { askRow, cancelRow, CLOSED_ROW, dismissRow, nameGiven, openRow, rowProblem, startRow } from '../src/lib/form-row';
import { createChange } from '../src/lib/change';
import { giveName, NOT_SAVED } from '../src/lib/write-failure';

// The form row's state (spec 0014): which row is open, and what a form says of a name that is not there. The words are
// write-failure's, so the cases assert that the row counts the asks and hands them on.
// The row's card is a real change (change.ts), so what is said on it and where focus goes are what the screen would see.

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

describe('a row on its card', () => {
  it('forgets what was said on the card when it opens, and when it closes', () => {
    const card = createChange();
    card.say('rename-list-2', 'Some words');
    const opened = openRow(card, 'list-1');
    expect(opened).toEqual({ id: 'list-1', asked: 0 });
    expect(card.state().problems).toEqual({});
    card.say('rename-list-1', 'More words');
    expect(cancelRow(card, opened, (id) => `rename-${id}`)).toEqual(CLOSED_ROW);
    expect(card.state().problems).toEqual({});
  });

  it('returns focus to the opener when a cancel closes the row', () => {
    const card = createChange();
    cancelRow(card, openRow(card, 'list-1'), (id) => `rename-${id}`);
    expect(card.state().focus).toBe('rename-list-1');
  });

  it('closes a removal that landed with no focus to the opener, and goes where the landing says', async () => {
    const card = createChange();
    let row = openRow(card, 'routine-1');
    await card.change('archive-routine-1', async () => undefined, {
      landed: () => {
        row = dismissRow(card);
        return 'profile-1';
      },
    });
    expect(row).toEqual(CLOSED_ROW);
    expect(card.state().focus).toBe('profile-1');
  });

  it('stays open, with its words said at its own place, when the removal failed', async () => {
    const card = createChange();
    const row = openRow(card, 'list-1');
    const outcome = await card.change('delete-list-1', async () => {
      throw new Error('boom');
    });
    expect(outcome).toBe('failed');
    expect(card.state().problems['delete-list-1']?.words).toBe(NOT_SAVED);
    // Only a cancel or a landed removal closes a row; a failure leaves it as it was.
    expect(row).toEqual({ id: 'list-1', asked: 0 });
  });
});
