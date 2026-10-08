import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Profile } from '../src/lib/profiles';
import { tapOutcome, tapRoutine, type Frame, type Measured } from '../src/lib/routine-tap';
import type { Routine } from '../src/lib/routines';
import type { RoutineColumn as RoutineColumnType } from '../src/components/RoutineColumn';

// What a tap on a Routine does on the Wall's column, the phone's card and Up next: one decision (src/lib/routine-tap.ts), tested here
// with plain numbers for the measuring, and the shared column drawn once for both layouts.

const ava: Profile = { id: 'ava', name: 'Ava', color: '#93c5fd', avatar_url: null, sort_order: 0 };
const routine = (id: string, title: string): Routine => ({ id, profile_id: 'ava', title, days_of_week: 127, time_of_day: 'morning', picture: null, sort_order: 0, archived_at: null });
const brush = routine('r-1', 'Brush teeth');
const dressed = routine('r-2', 'Get dressed');
const both = [brush, dressed];

// A button 80 px tall whose top is `top`, and a frame whose top is `top` with a border `clientTop` thick.
const button = (top: number, height = 80): Measured => ({ getBoundingClientRect: () => ({ top, height }) });
const frame = (top: number, clientTop = 0): Frame => ({ getBoundingClientRect: () => ({ top, height: 600 }), clientTop });

describe('tapOutcome', () => {
  it('ticks what is not done and takes back what is', () => {
    expect(tapOutcome(both, new Set(), 'r-1', button(0), frame(0)).checking).toBe(true);
    expect(tapOutcome(both, new Set(['r-1']), 'r-1', button(0), frame(0)).checking).toBe(false);
  });

  it('finishes the Profile on its last tick, starting the burst at the middle of the tile, from the frame\'s padding edge', () => {
    // The tile's middle is 340 + 40 = 380 on the page and the frame's padding edge 100 + 4: 276 px down it.
    expect(tapOutcome(both, new Set(['r-2']), 'r-1', button(340), frame(100, 4))).toEqual({ checking: true, finishes: true, burstAt: 276 });
  });

  it('starts no burst for a tick that leaves something to do, or for taking a tick back', () => {
    expect(tapOutcome(both, new Set(), 'r-1', button(340), frame(100))).toEqual({ checking: true, finishes: false, burstAt: null });
    expect(tapOutcome(both, new Set(['r-1', 'r-2']), 'r-1', button(340), frame(100))).toEqual({ checking: false, finishes: false, burstAt: null });
  });

  it('starts no burst before there is a frame to draw it in', () => {
    expect(tapOutcome(both, new Set(['r-2']), 'r-1', button(340), null)).toEqual({ checking: true, finishes: false, burstAt: null });
  });
});

describe('tapRoutine', () => {
  it('sends a tile\'s tap to toggle with that tile\'s Routine, ticking and unticking alike', () => {
    const toggle = vi.fn(() => Promise.resolve(true));
    const finish = vi.fn();
    const done = new Set(['r-2']);
    tapRoutine({ routines: [brush, dressed, routine('r-3', 'Pack bag')], done, routine: brush, button: button(0), frame: frame(0), onToggle: toggle, onFinish: finish });
    tapRoutine({ routines: [brush, dressed, routine('r-3', 'Pack bag')], done, routine: dressed, button: button(0), frame: frame(0), onToggle: toggle, onFinish: finish });
    expect(toggle.mock.calls).toEqual([[brush], [dressed]]);
    expect(finish).not.toHaveBeenCalled();
  });

  it('starts the burst before it toggles when the tap finishes the Profile', () => {
    const calls: string[] = [];
    tapRoutine({
      routines: both,
      done: new Set(['r-2']),
      routine: brush,
      button: button(340),
      frame: frame(100, 4),
      onToggle: () => {
        calls.push('toggle');
        return Promise.resolve(true);
      },
      onFinish: (at) => calls.push(`finish ${at}`),
    });
    expect(calls).toEqual(['finish 276', 'toggle']);
  });
});

describe('the shared column', () => {
  let RoutineColumn: typeof RoutineColumnType;
  beforeAll(async () => {
    // The tiles' pictures come with the app's client, which wants its env; CI has none (see tests/phone-routines.test.ts).
    vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
    ({ RoutineColumn } = await import('../src/components/RoutineColumn'));
  });

  const draw = (layout: { className: string; header: string; disc: number }) =>
    renderToStaticMarkup(
      createElement(RoutineColumn, {
        profile: ava,
        routines: both,
        done: new Set(['r-2']),
        part: 'morning',
        held: new Set<string>(),
        problem: undefined,
        onToggle: () => Promise.resolve(true),
        burst: undefined,
        onFinish: () => undefined,
        onLand: () => undefined,
        layout,
      }),
    );

  it('draws the progress header and a tile for each Routine, ticked or not, whatever the layout around it', () => {
    for (const layout of [
      { className: 'person relative wall-column', header: 'min-h-14', disc: 56 },
      { className: 'person relative phone-card', header: 'min-h-13', disc: 52 },
    ]) {
      const html = draw(layout);
      expect(html).toContain(`class="${layout.className}`);
      expect(html).toContain('1 of 2 done');
      expect([...html.matchAll(/aria-pressed="(true|false)"/g)].map((match) => match[1])).toEqual(['false', 'true']);
    }
  });
});
