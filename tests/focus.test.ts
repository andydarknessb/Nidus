import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusTitleIfLost } from '../src/lib/focus';

// After a page turns, focus goes to the page's title only if it was lost with the page: the button pressed went (or was switched
// off), or it fell to the page. A person paging by keyboard, or one on something else (a Profile chip), is not moved. There is no
// DOM in these tests, so the document is a stand-in with an active element, and the elements are what the function asks of them.
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

describe('focusTitleIfLost', () => {
  it('puts focus on the title when it fell to the page', () => {
    activeIs(BODY);
    const heading = title();
    focusTitleIfLost(heading as unknown as HTMLElement, { preventScroll: true });
    expect(heading.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('puts focus on the title when there is no active element at all', () => {
    activeIs(null);
    const heading = title();
    focusTitleIfLost(heading as unknown as HTMLElement);
    expect(heading.focus).toHaveBeenCalledOnce();
  });

  it('puts focus on the title when it is on a button that has just been switched off (Next on the last page)', () => {
    activeIs(new FakeButton(true));
    const heading = title();
    focusTitleIfLost(heading as unknown as HTMLElement);
    expect(heading.focus).toHaveBeenCalledOnce();
  });

  it('leaves focus where it is when it is on a button that still works (paging by keyboard)', () => {
    activeIs(new FakeButton(false));
    const heading = title();
    focusTitleIfLost(heading as unknown as HTMLElement);
    expect(heading.focus).not.toHaveBeenCalled();
  });

  it('leaves focus where it is when it is on anything else (a Profile chip, a field)', () => {
    activeIs({ tag: 'input' });
    const heading = title();
    focusTitleIfLost(heading as unknown as HTMLElement);
    expect(heading.focus).not.toHaveBeenCalled();
  });

  it('does nothing without a title', () => {
    activeIs(BODY);
    expect(() => focusTitleIfLost(null)).not.toThrow();
  });
});
