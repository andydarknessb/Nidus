import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusIsLost, moveFocus } from '../src/lib/focus';

// After a page turns, focus goes to the page's title only if it was lost with the page: the button pressed went (or was switched
// off), or it fell to the page. A person paging by keyboard, or one on something else (a Profile chip), is not moved. The paged view
// decides (paged-view.ts); focusIsLost is what it is asked and moveFocus is what is done. There is no DOM in these tests, so the
// document is a stand-in with an active element, and the elements are what the functions ask of them.
class FakeButton {
  constructor(readonly disabled: boolean) {}
}
const title = () => ({ focus: vi.fn() });

function activeIs(active: unknown) {
  vi.stubGlobal('document', { activeElement: active, body: BODY });
  vi.stubGlobal('HTMLButtonElement', FakeButton);
}
const BODY = { tag: 'body' };

afterEach(() => vi.unstubAllGlobals());

describe('focusIsLost', () => {
  it('is lost when it fell to the page', () => {
    activeIs(BODY);
    expect(focusIsLost()).toBe(true);
  });

  it('is lost when there is no active element at all', () => {
    activeIs(null);
    expect(focusIsLost()).toBe(true);
  });

  it('is lost when it is on a button that has just been switched off (Next on the last page)', () => {
    activeIs(new FakeButton(true));
    expect(focusIsLost()).toBe(true);
  });

  it('is not lost when it is on a button that still works (paging by keyboard)', () => {
    activeIs(new FakeButton(false));
    expect(focusIsLost()).toBe(false);
  });

  it('is not lost when it is on anything else (a Profile chip, a field)', () => {
    activeIs({ tag: 'input' });
    expect(focusIsLost()).toBe(false);
  });
});

describe('moveFocus', () => {
  it('puts focus on the title, keeping the options the phone passes', () => {
    const heading = title();
    moveFocus('title', heading as unknown as HTMLElement, { preventScroll: true });
    expect(heading.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('puts focus on the title with no options on the Wall', () => {
    const heading = title();
    moveFocus('title', heading as unknown as HTMLElement);
    expect(heading.focus).toHaveBeenCalledOnce();
  });

  it('leaves focus where it is when it was decided to go nowhere', () => {
    const heading = title();
    moveFocus('nowhere', heading as unknown as HTMLElement);
    expect(heading.focus).not.toHaveBeenCalled();
  });

  it('does nothing without a title', () => {
    expect(() => moveFocus('title', null)).not.toThrow();
  });
});
