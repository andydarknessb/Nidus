import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Card } from '../src/components/phone';

// A card's read (spec 0014): a card that reads says what failed, at its top, in the read's words; a card whose read is fine says
// nothing of it, and a card that does not read has no line at all.

const card = (props: Partial<ComponentProps<typeof Card>> = {}) =>
  renderToStaticMarkup(createElement(Card, { title: 'People', ...props }, createElement('p', null, 'A person')));

describe('a card that reads', () => {
  it('says nothing while the read is fine', () => {
    expect(card({ read: { failed: false }, of: 'people' })).not.toContain('role="alert"');
  });

  it("says what failed at its top, before what it holds, in the read's words", () => {
    const html = card({ read: { failed: true }, of: 'people' });
    expect(html).toMatch(/<h2[^>]*>People<\/h2><p role="alert" class="text-base">Could not load people\. Check your connection\.<\/p><p>A person<\/p>/);
  });

  it('can say it in narrower words instead', () => {
    expect(card({ read: { failed: true }, of: 'notifications', words: 'Could not check the notifications.' })).toContain(
      'Could not check the notifications.',
    );
  });

  it('says nothing at all when it does not read', () => {
    expect(card()).not.toContain('role="alert"');
  });
});
