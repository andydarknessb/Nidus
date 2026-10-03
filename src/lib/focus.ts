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
