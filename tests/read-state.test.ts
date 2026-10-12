import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BeforeHousehold } from '../src/components/BeforeHousehold';
import { ReadState } from '../src/components/ReadState';
import type { ReadStateName } from '../src/lib/synced-read';

// The read ladder (spec 0011), drawn once: "Loading", or the alert with what could not load, or what was read. Rendered to markup, so
// that what is asserted is what the browser is given. The screens' own cases (a Routines chart says "Loading" in the same style, the
// phone's Routines tab after Household midnight) stay with the screens; what moved here is the ladder itself.

const ladder = (state: ReadStateName, props: Partial<Parameters<typeof ReadState>[0]> = {}) =>
  renderToStaticMarkup(createElement(ReadState, { of: 'routines', read: { state }, ...props }, createElement('p', null, 'Ava')));

describe('ReadState', () => {
  it('says "Loading" in the one style every empty state has, while nothing has been read', () => {
    const html = ladder('loading');
    expect(html).toBe('<p class="text-base text-muted-foreground">Loading</p>');
  });

  it('says the screen\'s own words in an alert once the first read has failed, and no longer says it is loading', () => {
    const html = ladder('failed');
    expect(html).toBe('<p role="alert" class="text-base">Could not load routines. Check your connection.</p>');
  });

  it('draws what was read once something has been, and nothing of the ladder', () => {
    expect(ladder('ready')).toBe('<p>Ava</p>');
  });

  it('draws no children while nothing has been read, so a read that has not landed cannot show a half-made screen', () => {
    expect(ladder('loading')).not.toContain('Ava');
    expect(ladder('failed')).not.toContain('Ava');
  });

  it('places "Loading" and the alert as the screen asks, and says only the rung it is asked for', () => {
    expect(ladder('loading', { className: 'px-1' })).toContain('class="text-base text-muted-foreground px-1"');
    expect(ladder('failed', { alert: 'p-4 text-xl' })).toContain('class="p-4 text-xl"');
    expect(ladder('loading', { say: 'failed' })).toBe('');
    expect(ladder('failed', { say: 'loading' })).toBe('');
    expect(ladder('failed', { say: 'failed' })).toContain('role="alert"');
  });

  it('leaves the role off for a day that is one of several saying the same thing', () => {
    expect(ladder('failed', { announce: false })).toBe('<p class="text-base">Could not load routines. Check your connection.</p>');
  });
});

describe('the frame that stands in for a screen until the Household is read', () => {
  const frame = (failed: boolean) => renderToStaticMarkup(createElement(BeforeHousehold, { label: 'Meals', failed, of: 'meals' }));

  it('says "Loading" while the read is on its way, in the one style every empty state has', () => {
    const html = frame(false);
    expect(html).toMatch(/<p class="text-base text-muted-foreground p-4">Loading<\/p>/);
    expect(html).not.toContain('role="alert"');
  });

  it('says the screen\'s own words once the read has failed, and no longer says it is loading', () => {
    const html = frame(true);
    expect(html).toMatch(/<p role="alert"[^>]*>Could not load meals\. Check your connection\.<\/p>/);
    expect(html).not.toContain('Loading');
  });
});
