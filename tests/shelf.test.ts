import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Shelf } from '../src/components/Shelf';

// The shelf (spec 0014): the heading row with its controls and More, the sideways row with the wrapper that keeps a column mounted,
// and the portrait grid. A measurement decides whether More shows, so what is asserted here is the markup that holds it.

const shelf = (portrait: boolean) =>
  renderToStaticMarkup(
    createElement(Shelf, {
      title: createElement('h2', { id: 'shelf-title' }, 'A shelf'),
      controls: createElement('p', { className: 'the-controls' }, 'Controls'),
      between: createElement('p', null, 'Between'),
      of: 'people',
      footOf: 'the things',
      portrait,
      items: [createElement('div', { key: 'a' }, 'A'), createElement('div', { key: 'b' }, 'B')],
    }),
  );

describe('the shelf', () => {
  it('puts the title, the controls and what sits between them in the heading row', () => {
    const html = shelf(false);
    expect(html).toMatch(/^<div class="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2"><h2 id="shelf-title">A shelf<\/h2>/);
    expect(html).toContain('class="the-controls"');
    expect(html).toContain('<p>Between</p>');
  });

  it('holds the row sideways, with the wrapper that keeps a column mounted', () => {
    const html = shelf(false);
    expect(html).toContain('flex min-h-0 flex-1 items-start gap-3 overflow-x-auto');
    expect(html).toContain('<div class="contents"><div>A</div><div>B</div></div>');
  });

  it('turns the row into a grid in portrait, with no sideways wrapper', () => {
    const html = shelf(true);
    expect(html).toContain('min-h-0 flex-1 overflow-y-auto');
    expect(html).toContain('grid grid-cols-[repeat(auto-fit,minmax(min(17rem,100%),1fr))] items-start gap-x-3 gap-y-4');
    expect(html).not.toContain('class="contents"');
  });

  it('takes a row and a grid class from the screen it is on', () => {
    const html = renderToStaticMarkup(
      createElement(Shelf, {
        title: createElement('h2', null, 'A shelf'),
        of: 'lists',
        portrait: false,
        items: [],
        rowClassName: 'snap-x gap-4 a-card-wide',
        gridClassName: 'gap-4',
      }),
    );
    expect(html).toContain('<div class="snap-x gap-4 a-card-wide"><div class="contents"></div></div>');
  });
});
