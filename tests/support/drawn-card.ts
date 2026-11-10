import type { SupabaseClient } from '@supabase/supabase-js';
import { listCard, type ListCardEffects, type ListCardView } from '../../src/lib/list-card';
import type { ListItem } from '../../src/lib/shared-lists';
import type { ReadStateName } from '../../src/lib/synced-read';

// A Shared List card drawn to markup in a test: the core over fixed facts. A render makes no read and no write, so the effects that would
// make one throw; `problem` is what a write said at the list's place. The card's reads and writes are driven in list-card-core.test.ts.
export function drawnCard(listId: string, facts: { items: unknown[]; state?: ReadStateName; problem?: string }): ListCardView {
  const { items, state = 'ready', problem = '' } = facts;
  const busy = false;
  const unmade = () => {
    throw new Error('a drawn card makes no write');
  };
  const effects: ListCardEffects = {
    client: undefined as unknown as SupabaseClient,
    write: unmade,
    change: unmade,
    fail: () => undefined,
    say: () => undefined,
    clear: () => undefined,
    problem: (place) => (problem ? { place, words: problem, n: 1, refused: false } : null),
  };
  return listCard({ listId, items: items as ListItem[], state, busy }, effects);
}
