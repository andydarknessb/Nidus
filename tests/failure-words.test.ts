import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NOT_SAVED, NOT_SAVED_OFFLINE } from '../src/lib/write-failure';

// One trouble, one thing said (spec 0003, A tick that did not save): a write on the Wall that did not go through says what the phone
// says (src/lib/write-failure.ts), whether it was a tick, an item, a cross-off, a meal or an event. The five places used to say it five
// ways at four sizes: "Could not add that item. Try again." (14 px), "Could not update that item. It has been put back." (16),
// "Could not save the meal. Check your connection and try again." (18), and the event sheet's "Check your connection" for a server error.
// The wiring is in components that need a browser to draw, so the source of each is read.

const source = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
const WRITERS = ['SharedListsPage.tsx', 'lib/use-shared-lists.ts', 'MealsPage.tsx', 'components/NativeEventSheet.tsx'];

describe("the Wall's writers", () => {
  it('say their trouble through the one vocabulary, chosen when the write fails', () => {
    for (const file of WRITERS) {
      // The Shared Lists' writer is in lib/use-shared-lists.ts (shared with the phone); the screens that write draw its hook or use their own.
      if (file === 'SharedListsPage.tsx') continue;
      expect(source(file), file).toMatch(/from '(\.\/|\.\.\/lib\/)(lib\/)?use-failure-words'/);
      expect(source(file), file).toContain('useFailureWords()');
    }
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
