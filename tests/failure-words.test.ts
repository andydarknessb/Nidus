import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NOT_SAVED, NOT_SAVED_OFFLINE } from '../src/lib/write-failure';

// One trouble, one thing said (spec 0003, A tick that did not save): a write on the Wall that did not go through says what the phone
// says (src/lib/write-failure.ts), whether it was a tick, an item, a cross-off, a meal or an event. The five places used to say it five
// ways at four sizes: "Could not add that item. Try again." (14 px), "Could not update that item. It has been put back." (16),
// "Could not save the meal. Check your connection and try again." (18), and the event sheet's "Check your connection" for a server error.
// The wiring is in components that need a browser to draw, so the source of each is read.

const source = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
const WRITERS = ['SharedListsPage.tsx', 'lib/list-card.ts', 'lib/use-shared-lists.ts', 'MealsPage.tsx', 'components/NativeEventSheet.tsx'];

describe("the Wall's writers", () => {
  it('say their trouble through the one vocabulary, chosen when the write fails', () => {
    // The Shared Lists' writes are the list card's (lib/list-card.ts), and they say a failure through the change's own fail, which words it
    // with writeFailureWords (change.ts). The hook and the screens that draw the card write nothing of their own.
    expect(source('lib/list-card.ts')).toContain('effects.fail(');
    for (const file of ['MealsPage.tsx', 'components/NativeEventSheet.tsx']) {
      // The event sheet's form and the Meal sheet say it through the change (useChange, which words a failure with writeFailureWords:
      // tests/event-sheets.test.ts and tests/change.test.ts).
      expect(source(file), file).toContain('useChange()');
    }
  });

  // A retry that fails again is a new alert, heard again: each place's alert takes the change's count as its key (change.ts `n`). Drawn
  // markup does not show keys, so the source is what is checked.
  it("take the list's count as the key of their alerts", () => {
    expect(source('components/ListCard.tsx'), 'ListCard').toContain('<p key={problemKey} role="alert"');
    expect(source('SharedListsPage.tsx'), 'SharedListsPage').toContain('<p key={problemKey} role="alert"');
  });

  it('keep none of the sentences they said before', () => {
    for (const file of WRITERS) {
      const code = source(file).replace(/\/\/.*$/gm, '');
      expect(code, file).not.toContain('Check your connection and try again');
      expect(code, file).not.toContain('It has been put back');
      expect(code, file).not.toContain('They have been put back');
      expect(code, file).not.toContain('Could not add that item');
      expect(code, file).not.toContain('Could not update that item');
      expect(code, file).not.toContain('Could not clear the crossed off items');
      expect(code, file).not.toContain('Could not save the meal');
      expect(code, file).not.toContain('Could not save the event');
      expect(code, file).not.toContain('Could not delete the event');
    }
  });

  it("are the phone's two sentences: that did not save, or that there is no internet", () => {
    expect(NOT_SAVED).toBe('That did not save. Try again.');
    expect(NOT_SAVED_OFFLINE).toBe('No internet, so that did not save. Try again soon.');
  });
});
