import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { createChange as CreateChange } from '../src/lib/change';
import { shareEnd } from '../src/lib/send-to-target';
import { gotIds, type ListItem } from '../src/lib/shared-lists';

// The paths of the two sheets that decide what a press does (docs/specs/0019): what a Share that ended means, which items Cross off
// sends, and that a Send or Got it write is a change of its own place (ADR 0006): a second press while one is on its way does nothing,
// and a failure is said at that place. The sheets draw these decisions; the decisions are tested here, against the change's own core.

vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');

let createChange: typeof CreateChange;
beforeAll(async () => {
  ({ createChange } = await import('../src/lib/change'));
});

const item = (id: string, sent_at: string | null = '2026-10-09T21:00:00Z'): ListItem => ({ id, list_id: 'l', text: id, crossed_at: null, sent_at, sort_order: 0 });

describe('a Share that ended', () => {
  it('marks the list sent when the share resolved, and says nothing', () => {
    expect(shareEnd(undefined)).toEqual({ marks: true, said: '' });
  });

  it('marks nothing and says nothing when the person closed the share sheet', () => {
    expect(shareEnd(new DOMException('Share canceled', 'AbortError'))).toEqual({ marks: false, said: '' });
  });

  it('marks nothing and says so when the share failed for another reason', () => {
    expect(shareEnd(new Error('not allowed'))).toEqual({ marks: false, said: "Couldn't share. Try Copy." });
  });
});

describe('what Cross off sends on the Got it sheet', () => {
  const items = [item('milk'), item('eggs'), item('bread')];

  it('sends every waiting item when none is unticked (all ticked at first)', () => {
    expect(gotIds(items, new Set())).toEqual(['milk', 'eggs', 'bread']);
  });

  it('leaves out an unticked item, and sends nothing when every one is unticked', () => {
    expect(gotIds(items, new Set(['eggs']))).toEqual(['milk', 'bread']);
    expect(gotIds(items, new Set(['milk', 'eggs', 'bread']))).toEqual([]);
  });

  it('ticks an item that starts waiting while the sheet is open, and drops one that stops waiting', () => {
    expect(gotIds([...items, item('cheese')], new Set(['eggs']))).toEqual(['milk', 'bread', 'cheese']);
    expect(gotIds([item('milk')], new Set())).toEqual(['milk']);
  });
});

describe('a Send or Got it write is a change of its own place', () => {
  it('a second press while one is on its way does nothing: the work runs once and the second is busy', async () => {
    const core = createChange();
    const work = vi.fn(async () => 1);
    const outcomes = await Promise.all([core.change('sent-l', work), core.change('sent-l', work)]);
    expect(outcomes.sort()).toEqual(['busy', 'done']);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('a failure is said at the list\'s own place, and nowhere else', async () => {
    const core = createChange();
    const outcome = await core.change('got-l', async () => {
      throw new Error('boom');
    });
    expect(outcome).toBe('failed');
    expect(core.state().problems['got-l']).toMatchObject({ place: 'got-l' });
    expect(core.state().problems['sent-l']).toBeUndefined();
  });

  it('a write that lands takes away the failure said at its place', async () => {
    const core = createChange();
    await core.change('sent-l', async () => {
      throw new Error('boom');
    });
    expect(core.state().problems['sent-l']).toBeDefined();
    expect(await core.change('sent-l', async () => 2)).toBe('done');
    expect(core.state().problems['sent-l']).toBeUndefined();
  });
});
