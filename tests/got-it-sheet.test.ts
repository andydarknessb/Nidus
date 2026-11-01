import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { GotItSheet as GotItSheetType } from '../src/components/GotItSheet';
import type { ListItem } from '../src/lib/shared-lists';

// The Got it sheet drawn to markup (docs/specs/0019, "The Got it sheet"): every item waiting for Got it is ticked at first, the foot
// names how many are ticked, and the sheet is named. Its writes run against the local stack (tests/list-sent.test.ts).

vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');

let GotItSheet: typeof GotItSheetType;
beforeAll(async () => {
  ({ GotItSheet } = await import('../src/components/GotItSheet'));
});

const sent = (id: string, text: string): ListItem => ({ id, list_id: 'l-1', text, crossed_at: null, sent_at: '2026-10-09T21:00:00Z', sort_order: 0 });
const waiting = [sent('i-1', 'Milk'), sent('i-2', 'Ground beef, 2 lb')];

const render = (items: ListItem[]) => renderToStaticMarkup(createElement(GotItSheet, { items, onCross: async () => '', onClose: () => undefined }));

describe('the Got it sheet', () => {
  it('is named Got it? and asks to cross off every item waiting, all ticked', () => {
    const html = render(waiting);
    expect(html).toContain('Got it?');
    expect(html).toContain('aria-labelledby="got-it-title"');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(2);
    expect(html).toContain('>Cross off 2<');
  });

  it('lists the waiting items in the order given, as rows of their own', () => {
    const html = render(waiting);
    expect(html.indexOf('Milk')).toBeLessThan(html.indexOf('Ground beef, 2 lb'));
    expect(html.match(/<li>/g)).toHaveLength(2);
  });
});
