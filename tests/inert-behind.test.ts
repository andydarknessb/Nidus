import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StatusLineProvider } from '../src/components/StatusLine';
import { BEHIND_SHEETS, holdBackground } from '../src/lib/inert-behind';

// While a sheet is open the page behind it is inert (docs/look.md, A sheet): out of the accessibility tree, so a screen reader cannot
// swipe out of the sheet to the rail's buttons, and out of reach of the keyboard and of a touch. The rule is a count, so that a sheet
// that replaces another (the list a "+N" opens, then an event's details, then Edit) never leaves the page behind it reachable between
// them, nor inert after the last has gone. The elements are anything with an `inert` flag, so no document is needed here.

const part = () => ({ inert: false });

describe('the page behind a sheet', () => {
  it('is inert while a sheet is open, and reachable again when it closes', () => {
    const rail = part();
    const release = holdBackground([rail]);
    expect(rail.inert).toBe(true);
    release();
    expect(rail.inert).toBe(false);
  });

  it('holds every part that is behind it', () => {
    const [a, b, c] = [part(), part(), part()];
    const release = holdBackground([a, b, c]);
    expect([a, b, c].map((each) => each.inert)).toEqual([true, true, true]);
    release();
    expect([a, b, c].map((each) => each.inert)).toEqual([false, false, false]);
  });

  it('stays inert until the last of two sheets has closed, whichever closes first', () => {
    for (const order of [[0, 1], [1, 0]] as const) {
      const rail = part();
      const releases = [holdBackground([rail]), holdBackground([rail])];
      releases[order[0]]!();
      expect(rail.inert, `after the ${order[0] + 1}. closes`).toBe(true);
      releases[order[1]]!();
      expect(rail.inert, `after both have closed`).toBe(false);
    }
  });

  it('is let go of once, however often it is asked: a sheet that closes twice never frees what another still holds', () => {
    const rail = part();
    const first = holdBackground([rail]);
    const second = holdBackground([rail]);
    first();
    first();
    first();
    expect(rail.inert).toBe(true);
    second();
    expect(rail.inert).toBe(false);
  });

  it('holds only what it was given, and nothing when it is given nothing (a sheet drawn with no app behind it)', () => {
    const behind = part();
    const elsewhere = part();
    const release = holdBackground([behind]);
    expect(elsewhere.inert).toBe(false);
    release();
    expect(() => holdBackground([])()).not.toThrow();
  });

  it('lets a part that is held again after it was let go be held as new', () => {
    const rail = part();
    holdBackground([rail])();
    expect(rail.inert).toBe(false);
    const again = holdBackground([rail]);
    expect(rail.inert).toBe(true);
    again();
    expect(rail.inert).toBe(false);
  });
});

describe('what is behind a sheet', () => {
  const page = () => renderToStaticMarkup(createElement(StatusLineProvider, { children: createElement('main', null, 'The Wall') }));

  it('is the whole screen, in a wrapper with no box of its own, found by the attribute the sheets look for', () => {
    expect(page()).toContain(`<div ${BEHIND_SHEETS}="" class="contents"><main>The Wall</main></div>`);
  });

  it('is not the status line, which is beside it: a line said as a sheet closes is announced, not lost to a page still inert', () => {
    const html = page();
    expect(html.slice(0, html.indexOf('</main></div>'))).not.toContain('role="status"');
    expect(html.indexOf('role="status"')).toBeGreaterThan(html.indexOf('</main></div>'));
  });
});
