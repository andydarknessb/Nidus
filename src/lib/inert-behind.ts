// While a sheet is open, the page behind it is inert: out of the accessibility tree (a screen reader on a phone cannot swipe out of
// the sheet to the buttons under it), and out of reach of the keyboard and of a touch. The sheets stay interactive because they are
// drawn outside what is held (components/InBody.tsx).

// What is behind a sheet carries this: StatusLineProvider's wrapper, which holds the whole app and not the status line, so a line said
// as a sheet closes is still announced.
export const BEHIND_SHEETS = 'data-behind-sheets';

// Anything with an `inert` flag, which is every element: the rule below needs no document, so it is tested without one.
type Holdable = { inert: boolean };

// How many open sheets hold each part. A sheet that replaces another, in the same moment, must neither leave the page reachable
// between them nor leave it inert after the last has gone.
const held = new Map<Holdable, number>();

// Makes `behind` inert for as long as a sheet is open, and returns what lets it go. It is back when the last sheet that held it has
// let go; letting go twice is the same as once.
export function holdBackground(behind: Iterable<Holdable>): () => void {
  const mine = [...behind];
  for (const part of mine) {
    held.set(part, (held.get(part) ?? 0) + 1);
    part.inert = true;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const part of mine) {
      const left = (held.get(part) ?? 1) - 1;
      if (left > 0) {
        held.set(part, left);
      } else {
        held.delete(part);
        part.inert = false;
      }
    }
  };
}

// What is behind a sheet on this page now, for a sheet to hold.
export function appBehind(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`[${BEHIND_SHEETS}]`)];
}
