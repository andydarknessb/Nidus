import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Card } from '../src/components/phone';

// A card's read (spec 0014): a card that reads says what failed, at its top, in the read's words; a card whose read is fine says
// nothing of it, and a card that does not read has no line at all.

const body = createElement('p', null, 'A person');

const card = (read?: { failed: boolean }, of = 'people', words?: string) =>
  renderToStaticMarkup(
    read
      ? createElement(Card, { title: 'People', read, of, words, children: body })
      : createElement(Card, { title: 'People', children: body }),
  );

describe('a card that reads', () => {
  it('says nothing while the read is fine', () => {
    expect(card({ failed: false })).not.toContain('role="alert"');
  });

  it("says what failed at its top, before what it holds, in the read's words", () => {
    const html = card({ failed: true });
    expect(html).toMatch(/<h2[^>]*>People<\/h2><p role="alert" class="text-base">Could not load people\. Check your connection\.<\/p><p>A person<\/p>/);
  });

  it('can say it in narrower words instead', () => {
    expect(card({ failed: true }, 'notifications', 'Could not check the notifications.')).toContain('Could not check the notifications.');
  });

  it('says nothing at all when it does not read', () => {
    expect(card()).not.toContain('role="alert"');
  });
});
