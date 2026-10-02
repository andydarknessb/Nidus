import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EmptyRing, HouseDisc, MAX_PIPS, PersonDisc, Pips, Tick } from '../src/components/people';
import { personStyle } from '../src/lib/look';

// The atoms a person is drawn from (src/components/people.tsx), rendered to markup, so what is asserted is what the browser is
// given. An atom drawn in a person's colour takes the Profile's stored colour and carries the class `person` and the four steps
// itself: it needs no `person` ancestor to be coloured, and an ancestor's colours never reach it.

const AVA = '#93c5fd';
const steps = Object.entries(personStyle(AVA)).map(([name, value]) => `${name}:${value}`);

// The class list and the style of the first element of some markup.
function root(html: string): { classes: string[]; style: string } {
  return {
    classes: /^<[a-z]+[^>]*? class="([^"]*)"/.exec(html)?.[1]?.split(' ') ?? [],
    style: /^<[a-z]+[^>]*? style="([^"]*)"/.exec(html)?.[1] ?? '',
  };
}

const render = (element: ReactElement) => root(renderToStaticMarkup(element));

describe('an atom drawn in a person\'s colour', () => {
  const atoms: Record<string, ReactElement> = {
    'a disc': createElement(PersonDisc, { name: 'Ava', color: AVA }),
    'progress': createElement(Pips, { done: 1, total: 3, label: 'Ava: 1 of 3 Routines done', color: AVA }),
    'a ring': createElement(EmptyRing, { color: AVA }),
    'a tick': createElement(Tick, { color: AVA }),
    'a tick beside progress': createElement(Tick, { color: AVA, strong: true }),
  };

  it('carries the class person and the four steps of the stored colour itself', () => {
    for (const [what, element] of Object.entries(atoms)) {
      const { classes, style } = render(element);
      expect(classes, what).toContain('person');
      for (const step of steps) expect(style, `${what}: ${step}`).toContain(step);
    }
  });

  it('is drawn in that person\'s roles: strong for a disc, a ring and the pips, the tick pair for a tick on a finished tile', () => {
    expect(render(atoms['a disc']!).classes).toEqual(expect.arrayContaining(['bg-person-strong', 'text-person-on-strong']));
    expect(render(atoms['a ring']!).classes).toEqual(expect.arrayContaining(['text-person-strong']));
    expect(render(atoms['a ring']!).classes).not.toContain('text-input');
    expect(render(atoms['a tick']!).classes).toEqual(expect.arrayContaining(['bg-person-tick', 'text-person-on-tick']));
    expect(render(atoms['a tick']!).classes).not.toContain('bg-primary');
    expect(render(atoms['a tick beside progress']!).classes).toEqual(expect.arrayContaining(['bg-person-strong', 'text-person-on-strong']));
    expect(render(atoms['a tick beside progress']!).classes).not.toContain('bg-person-tick');
  });
});

describe('an atom with no person to be', () => {
  it('is neutral and does not claim the class person: a ring in --input, a tick in --primary, the house in --primary', () => {
    const ring = render(createElement(EmptyRing, {}));
    expect(ring.classes).toContain('text-input');
    expect(ring.classes).not.toContain('person');
    expect(ring.style).not.toContain('--person');
    const tick = render(createElement(Tick, {}));
    expect(tick.classes).toEqual(expect.arrayContaining(['bg-primary', 'text-primary-foreground']));
    expect(tick.classes).not.toContain('person');
    const house = render(createElement(HouseDisc, {}));
    expect(house.classes).toEqual(expect.arrayContaining(['bg-primary', 'text-primary-foreground']));
    expect(house.classes).not.toContain('person');
  });

  it('is neutral when the colour is not there yet', () => {
    const tick = render(createElement(Tick, { color: undefined, strong: true }));
    expect(tick.classes).toContain('bg-primary');
    expect(tick.classes).not.toContain('person');
  });
});

describe('the pips', () => {
  const pips = (done: number, total: number) => renderToStaticMarkup(createElement(Pips, { done, total, label: 'Ava: progress', color: AVA }));
  const count = (html: string, text: string) => html.split(text).length - 1;

  it('is one pip for each Routine, filled for each one done, and says how far it is to a screen reader', () => {
    const html = pips(2, 3);
    expect(count(html, 'bg-person-strong')).toBe(2);
    expect(count(html, 'flex-1')).toBe(3);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-label="Ava: progress"');
    expect(html).toContain('aria-valuenow="2"');
    expect(html).toContain('aria-valuemax="3"');
  });

  it('draws nothing for no Routines, or for more than eight: the count alone says how far someone is', () => {
    expect(MAX_PIPS).toBe(8);
    expect(pips(0, 0)).toBe('');
    expect(pips(3, MAX_PIPS + 1)).toBe('');
    expect(pips(3, MAX_PIPS)).not.toBe('');
  });
});
