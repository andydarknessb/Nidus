import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Profile } from '../src/lib/profiles';
import type { Routine } from '../src/lib/routines';
import type { PersonCard as PersonCardType } from '../src/phone/PhoneRoutines';

// A tile's tap on the phone's card reaches the Wall's one reader: `routines.toggle`, with that tile's Routine. renderToStaticMarkup draws
// no events, so the card (whose only hook is a ref, which has nothing to point at here) is expanded to its elements and the button's own
// handler is called.
vi.mock('react', async (original) => ({ ...(await original<typeof import('react')>()), useRef: () => ({ current: null }) }));

let PersonCard: typeof PersonCardType;
beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
  ({ PersonCard } = await import('../src/phone/PhoneRoutines'));
});

// Every host element under `node`, calling function components (none here has a hook but the card's ref) on the way down.
function hosts(node: ReactNode, found: ReactElement<Record<string, unknown>>[] = []): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) node.forEach((child) => hosts(child as ReactNode, found));
  else if (isValidElement<Record<string, unknown>>(node)) {
    if (typeof node.type === 'function') hosts((node.type as (props: unknown) => ReactNode)(node.props), found);
    else {
      found.push(node);
      hosts(node.props['children'] as ReactNode, found);
    }
  }
  return found;
}

const ava: Profile = { id: 'ava', name: 'Ava', color: '#93c5fd', avatar_url: null, sort_order: 0 };
const routine = (id: string, title: string): Routine => ({ id, profile_id: 'ava', title, days_of_week: 127, time_of_day: 'morning', picture: null, sort_order: 0, archived_at: null });

describe('the phone card', () => {
  it('sends a tile\'s tap to routines.toggle with that tile\'s Routine, ticking and unticking alike', () => {
    const toggle = vi.fn(() => Promise.resolve(true));
    const brush = routine('r-1', 'Brush teeth');
    const dressed = routine('r-2', 'Get dressed');
    const card = PersonCard({
      column: { profile: ava, routines: [brush, dressed] },
      part: 'morning',
      held: new Set(),
      done: new Set(['r-2']),
      problem: undefined,
      onToggle: toggle,
      burst: undefined,
      onFinish: () => undefined,
      onLand: () => undefined,
    });
    const tiles = hosts(card).filter((element) => element.type === 'button' && element.props['aria-pressed'] !== undefined);
    expect(tiles.map((tile) => tile.props['aria-pressed'])).toEqual([false, true]);
    (tiles[0]!.props['onClick'] as (event: unknown) => void)({ currentTarget: {} });
    (tiles[1]!.props['onClick'] as (event: unknown) => void)({ currentTarget: {} });
    expect(toggle.mock.calls).toEqual([[brush], [dressed]]);
  });
});
