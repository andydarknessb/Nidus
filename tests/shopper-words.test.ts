import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { askShopper, shopperWords, suggestedWords, type ShopperOutcome } from '../src/lib/shopper';

// The shopper's words (spec 0019, ticket 3): every outcome has its words, and the copy has no em-dashes.

describe('shopperWords', () => {
  it.each<[ShopperOutcome, string | null]>([
    ['no-meals', 'No meals planned for the next 7 days.'],
    ['nothing-new', 'Nothing to add. Groceries already has it all.'],
    ['limit', 'Suggest from meals has been used 10 times today. Try again tomorrow.'],
    ['failed', "Couldn't make suggestions. Try again."],
    ['not-set-up', "The shopper isn't set up yet."],
    ['suggested', null],
  ])('says the words for %s', (outcome, words) => {
    expect(shopperWords(outcome, 'Groceries')).toBe(words);
  });

  it('has no em-dashes in any of its copy', () => {
    const outcomes: ShopperOutcome[] = ['no-meals', 'nothing-new', 'limit', 'failed', 'not-set-up', 'suggested'];
    for (const outcome of outcomes) expect(shopperWords(outcome, 'Groceries') ?? '').not.toContain('—');
    expect(suggestedWords(2, 'Groceries')).not.toContain('—');
  });
});

describe('suggestedWords', () => {
  it('counts the suggestions for the list in the status line', () => {
    expect(suggestedWords(3, 'Groceries')).toBe('3 suggestions for Groceries.');
    expect(suggestedWords(1, 'Groceries')).toBe('1 suggestion for Groceries.');
  });
});

// A stand-in for the one Functions call; the errors are the client's own classes, as the SDK raises them.
function clientAnswering(result: { data?: unknown; error?: unknown }): SupabaseClient {
  return { functions: { invoke: async () => ({ data: result.data ?? null, error: result.error ?? null }) } } as unknown as SupabaseClient;
}

describe('askShopper', () => {
  it('returns the outcome and count of a suggestion', async () => {
    expect(await askShopper(clientAnswering({ data: { outcome: 'suggested', count: 2 } }), 'l-1')).toEqual({ outcome: 'suggested', count: 2 });
  });

  it('reads the outcome a refusal carries in its body, the limit for one', async () => {
    const refusal = new FunctionsHttpError(new Response(JSON.stringify({ outcome: 'limit' }), { status: 429 }));
    expect(await askShopper(clientAnswering({ error: refusal }), 'l-1')).toEqual({ outcome: 'limit' });
  });

  it('says a failure when nothing answers, or the answer is not an outcome', async () => {
    expect(await askShopper(clientAnswering({ error: new Error('offline') }), 'l-1')).toEqual({ outcome: 'failed' });
    expect(await askShopper(clientAnswering({ data: { outcome: 'bogus' } }), 'l-1')).toEqual({ outcome: 'failed' });
  });
});
