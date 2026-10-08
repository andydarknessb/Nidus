import type { FocusAt } from './paged-view';

// Putting focus back on the Wall's calendar when the element it would return to has gone: an event that was deleted, or that an edit
// moved to another place on the screen. A sheet gives focus back to what opened it, but a read can then take that away, and focus
// falls to the page, where Escape, Tab and a screen reader's place are all lost. The views say where it goes; this is how they look.

// Focuses `element` and says whether it took focus: an element that is hidden, or not there, cannot.
export function focusElement(element: HTMLElement | null | undefined): boolean {
  if (!element) return false;
  element.focus();
  return document.activeElement === element;
}

// Focuses the pill or the block of the event `id` that can take focus. The schedule draws every pill and holds the ones that do not
// fit out of reach, and the same event is a pill in each day it covers, so the first that can is the one.
export function focusEvent(id: string): boolean {
  return [...document.querySelectorAll<HTMLElement>(`[data-event="${CSS.escape(id)}"]`)].some((element) => focusElement(element));
}

// Whether focus was lost with a page that has turned or moved: it fell to the page, or it is on a button that was just switched off.
// Paging may disable or remove the button that was pressed, and a button that was just switched off still has the focus for a moment, so
// it counts as lost. A person paging with the keyboard, or one who was on something else (a Profile's chip), is where they were and is not
// lost. The paged view (paged-view.ts) decides from this whether focus goes to the page's title.
export function focusIsLost(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || (active instanceof HTMLButtonElement && active.disabled);
}

// Does what the paged view decided: puts focus on the page's title, or does nothing. `options` is how the phone keeps the page from
// scrolling (preventScroll); with no title yet there is nothing to focus.
export function moveFocus(at: FocusAt, title: HTMLElement | null | undefined, options?: FocusOptions): void {
  if (at === 'title') title?.focus(options);
}
