import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';

// The shopper (spec 0019, ticket 3): asks the shopper Edge Function for suggestions for one list. The function answers facts (`outcome`,
// and `count` when it suggested); the words are here, and nothing else words them.

export type ShopperOutcome = 'suggested' | 'nothing-new' | 'no-meals' | 'limit' | 'failed' | 'not-set-up';
export type ShopperAnswer = { outcome: ShopperOutcome; count?: number };

const OUTCOMES: readonly string[] = ['suggested', 'nothing-new', 'no-meals', 'limit', 'failed', 'not-set-up'];

function isAnswer(value: unknown): value is ShopperAnswer {
  return typeof value === 'object' && value !== null && 'outcome' in value && typeof value.outcome === 'string' && OUTCOMES.includes(value.outcome);
}

// Asks for suggestions. A refusal (a non-2xx answer) carries its outcome in the body; anything else, such as no network, is a failure.
export async function askShopper(client: SupabaseClient, listId: string): Promise<ShopperAnswer> {
  const { data, error } = await client.functions.invoke('shopper', { body: { list_id: listId } });
  if (!error) return isAnswer(data) ? data : { outcome: 'failed' };
  const body: unknown = error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : null;
  return isAnswer(body) ? body : { outcome: 'failed' };
}

// What the card says at its foot for an outcome. `suggested` says nothing there: the rows appear and the status line says how many.
export function shopperWords(outcome: ShopperOutcome, listName: string): string | null {
  switch (outcome) {
    case 'no-meals':
      return 'No meals planned for the next 7 days.';
    case 'nothing-new':
      return `Nothing to add. ${listName} already has it all.`;
    case 'limit':
      return 'Suggest from meals has been used 10 times today. Try again tomorrow.';
    case 'failed':
      return "Couldn't make suggestions. Try again.";
    case 'not-set-up':
      return "The shopper isn't set up yet.";
    case 'suggested':
      return null;
  }
}

// The status line once suggestions land.
export function suggestedWords(count: number, listName: string): string {
  return `${count} ${count === 1 ? 'suggestion' : 'suggestions'} for ${listName}.`;
}
