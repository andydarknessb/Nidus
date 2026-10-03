// Helpers for the tests that read the markup a component renders (renderToStaticMarkup), so a test can say which part of a
// screen holds what, and not only that the words are somewhere on it.

// The whole element that opens at `index` in `html`: from its opening tag to its closing one, the elements of the same name inside
// it included.
export function elementAt(html: string, index: number): string {
  const name = /^<([a-z][a-z0-9]*)/i.exec(html.slice(index))?.[1];
  if (!name) throw new Error(`no element opens at ${index}`);
  const tag = new RegExp(`<(/?)${name}\\b[^>]*>`, 'g');
  tag.lastIndex = index;
  let depth = 0;
  for (let found = tag.exec(html); found; found = tag.exec(html)) {
    depth += found[1] ? -1 : 1;
    if (depth === 0) return html.slice(index, tag.lastIndex);
  }
  throw new Error(`the element that opens at ${index} never closes`);
}

// The boxes that scroll up and down in `html`: every element whose class says `overflow-y-auto`, whole.
export function scrollers(html: string): string[] {
  return [...html.matchAll(/<[a-z][a-z0-9]*\b[^>]*class="[^"]*\boverflow-y-auto\b[^"]*"[^>]*>/g)].map((found) => elementAt(html, found.index));
}
