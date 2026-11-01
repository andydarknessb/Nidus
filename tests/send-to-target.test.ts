import { describe, expect, it } from 'vitest';
import { chatGptLink, CHATGPT_LINK_LIMIT, namedIn, targetMessage, type Usual } from '../src/lib/send-to-target';
import { lastSentMs, waitingItems, withGot, withSent, type ListItem } from '../src/lib/shared-lists';

// The Send to Target message, the Open link's rule, and the sent mark's optimistic rows (spec 0019, "The Send to Target sheet" and
// "The sent mark"). Pure: no local stack.

const item = (text: string, extra: Partial<ListItem> = {}): ListItem => ({
  id: text,
  list_id: 'l',
  text,
  crossed_at: null,
  sent_at: null,
  sort_order: 0,
  ...extra,
});

const milk: Usual = { name: 'milk', product: 'Good & Gather 2% milk, 1 gallon', target_link: 'https://www.target.com/p/milk/-/A-1' };

describe('targetMessage', () => {
  it('lists only the items given, in their order, and ends by asking before a swap', () => {
    expect(targetMessage([item('Milk'), item('Ground beef, 2 lb')], [])).toBe(
      ['Target, please build a cart with these items:', '- Milk', '- Ground beef, 2 lb', '', 'Ask me before swapping anything.'].join('\n'),
    );
  });

  it('adds the Usuals block for each Usual named in an item, with its link', () => {
    const message = targetMessage([item('Milk'), item('Eggs')], [milk]);
    expect(message).toBe(
      [
        'Target, please build a cart with these items:',
        '- Milk',
        '- Eggs',
        '',
        'Use our usual product when one fits:',
        '- milk: Good & Gather 2% milk, 1 gallon (https://www.target.com/p/milk/-/A-1)',
        '',
        'Ask me before swapping anything.',
      ].join('\n'),
    );
  });

  it('leaves out a Usual whose name is in none of the items, and the block when none is named', () => {
    const eggs: Usual = { name: 'eggs', product: 'Large brown eggs, 12 count', target_link: null };
    const message = targetMessage([item('Milk')], [eggs]);
    expect(message).not.toContain('usual product');
    expect(message).not.toContain('eggs');
  });

  it('names a Usual with no link without a bracket', () => {
    const eggs: Usual = { name: 'eggs', product: 'Large brown eggs, 12 count', target_link: null };
    expect(targetMessage([item('Eggs')], [eggs])).toContain('- eggs: Large brown eggs, 12 count\n');
  });
});

describe('namedIn', () => {
  it('matches whole words in any case', () => {
    expect(namedIn('Whole MILK', 'milk')).toBe(true);
    expect(namedIn('milk', 'Milk')).toBe(true);
    expect(namedIn('Ground beef, 2 lb', 'ground beef')).toBe(true);
  });

  it('does not match a name inside a longer word', () => {
    expect(namedIn('Milkshake', 'milk')).toBe(false);
    expect(namedIn('Buttermilk', 'milk')).toBe(false);
  });

  it('matches a multi-word name only as the words in a row', () => {
    expect(namedIn('Olive oil, extra virgin', 'olive oil')).toBe(true);
    expect(namedIn('oil, olive', 'olive oil')).toBe(false);
  });

  it('never matches an empty or punctuation-only name', () => {
    expect(namedIn('Milk', '   ')).toBe(false);
    expect(namedIn('Milk', '%')).toBe(false);
  });
});

describe('chatGptLink', () => {
  it('encodes the message into the chatgpt.com query', () => {
    expect(chatGptLink('Milk & eggs')).toBe('https://chatgpt.com/?q=Milk%20%26%20eggs');
  });

  it('is offered while the whole link is at most 8,000 characters, and not past it', () => {
    const fits = 'x'.repeat(CHATGPT_LINK_LIMIT - 'https://chatgpt.com/?q='.length);
    expect(chatGptLink(fits)?.length).toBe(CHATGPT_LINK_LIMIT);
    expect(chatGptLink(`${fits}x`)).toBeNull();
  });
});

describe('the sent mark on the rows', () => {
  const NOW = new Date('2026-10-09T22:02:00Z');

  it('waits only the items sent and not crossed off', () => {
    const rows = [
      item('Milk', { sent_at: '2026-10-09T21:00:00Z' }),
      item('Eggs', { sent_at: '2026-10-09T21:00:00Z', crossed_at: '2026-10-09T21:30:00Z' }),
      item('Bread'),
    ];
    expect(waitingItems(rows).map((row) => row.text)).toEqual(['Milk']);
  });

  it('reports the latest sent time among the waiting items, and none when nothing waits', () => {
    const rows = [item('Milk', { sent_at: '2026-10-09T21:00:00Z' }), item('Eggs', { sent_at: '2026-10-09T22:02:00Z' })];
    expect(lastSentMs(waitingItems(rows))).toBe(Date.parse('2026-10-09T22:02:00Z'));
    expect(lastSentMs([])).toBeNull();
  });

  it('withSent marks what is not crossed off, sent now, and leaves the rest as it is', () => {
    const rows = [item('Milk'), item('Eggs', { crossed_at: '2026-10-09T21:30:00Z' })];
    const marked = withSent(rows, NOW);
    expect(marked[0]?.sent_at).toBe(NOW.toISOString());
    expect(marked[1]).toEqual(rows[1]);
  });

  it('withGot crosses off the waiting items named, stops the others waiting, and leaves items not waiting alone', () => {
    const rows = [
      item('Milk', { sent_at: '2026-10-09T21:00:00Z' }),
      item('Eggs', { sent_at: '2026-10-09T21:00:00Z' }),
      item('Bread'),
    ];
    const got = withGot(rows, ['Milk'], NOW);
    expect(got[0]).toMatchObject({ crossed_at: NOW.toISOString(), sent_at: '2026-10-09T21:00:00Z' });
    expect(got[1]).toMatchObject({ crossed_at: null, sent_at: null });
    expect(got[2]).toEqual(rows[2]);
  });

  it('withGot leaves an item that is not waiting alone, even when its id is named', () => {
    const rows = [item('Eggs', { crossed_at: '2026-10-09T21:30:00Z' })];
    expect(withGot(rows, ['Eggs'], NOW)).toEqual(rows);
  });
});
