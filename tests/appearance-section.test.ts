import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AppearanceControl as AppearanceControlType } from '../src/AppearanceSection';

// The Appearance section of the phone's settings (src/AppearanceSection.tsx), rendered to markup, so what is asserted is what the
// browser is given. The saving is the section's own state; what it draws is a function of what it is told, and each state is
// rendered here. The section imports the Household reader, which builds the Supabase client on import: nothing here saves, so a
// placeholder URL and key are enough to load it.
let AppearanceControl: typeof AppearanceControlType;
beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
  ({ AppearanceControl } = await import('../src/AppearanceSection'));
});

type Props = ComponentProps<typeof AppearanceControlType>;

const render = (props: Partial<Props> = {}) =>
  renderToStaticMarkup(createElement(AppearanceControl, { chosen: 'auto', weatherOn: true, status: 'idle', onChoose: () => undefined, ...props }));

// The first element with this attribute: its opening tag's attributes, and the words inside it.
function holding(markup: string, attribute: string): { attributes: string; words: string } | undefined {
  const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = new RegExp(`<([a-z0-9]+)([^>]*${escaped}[^>]*)>([\\s\\S]*?)</\\1>`).exec(markup);
  return found ? { attributes: found[2] ?? '', words: (found[3] ?? '').replace(/<[^>]*>/g, '') } : undefined;
}

// Each choice as the browser gets it: its words, and whether it is pressed.
function choices(markup: string) {
  return [...markup.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*>([\s\S]*?)<\/button>/g)].map(([, pressed, inner]) => ({
    words: (inner ?? '').replace(/<[^>]*>/g, ''),
    pressed: pressed === 'true',
  }));
}

const APPEARANCES = ['light', 'dark', 'auto'] as const;
const STATUSES = ['idle', 'saved', 'failed'] as const;
const EVERY_STATE = APPEARANCES.flatMap((chosen) => [true, false].flatMap((weatherOn) => STATUSES.map((status) => ({ chosen, weatherOn, status }))));

describe('the Appearance section: the choices', () => {
  it('offers Light, Dark and Auto in that order, with the one chosen pressed and no other', () => {
    for (const chosen of APPEARANCES) {
      expect(choices(render({ chosen })), chosen).toEqual([
        { words: 'Light', pressed: chosen === 'light' },
        { words: 'Dark', pressed: chosen === 'dark' },
        { words: 'Auto', pressed: chosen === 'auto' },
      ]);
    }
  });

  it('keeps the choices 8 px apart, as docs/look.md has it, and not 4 as the drawing has it', () => {
    const group = holding(render(), 'role="group"');
    expect(group?.attributes).toMatch(/class="[^"]*\bgap-2\b/);
    expect(group?.attributes).not.toMatch(/class="[^"]*\bgap-1\b/);
  });

  it('is named by its label and described by what Auto does', () => {
    const markup = render();
    expect(holding(markup, 'role="group"')?.attributes).toContain('aria-labelledby="appearance-label"');
    expect(holding(markup, 'role="group"')?.attributes).toContain('aria-describedby="appearance-help"');
    expect(holding(markup, 'id="appearance-label"')?.words).toBe('The Wall looks');
    expect(holding(markup, 'id="appearance-help"')).toBeDefined();
  });
});

describe('the Appearance section: what Auto does', () => {
  const help = (props: Partial<Props>) => holding(render(props), 'id="appearance-help"')?.words;

  it('says it follows sunrise and sunset when the Household has a weather place', () => {
    for (const chosen of APPEARANCES) {
      expect(help({ weatherOn: true, chosen }), chosen).toBe('Auto is light from sunrise to sunset. The switch on the Wall changes it until the next sunrise or sunset.');
    }
  });

  it('says it runs from 7 AM to 7 PM when the Household has none, and how to get the sun', () => {
    for (const chosen of APPEARANCES) {
      expect(help({ weatherOn: false, chosen }), chosen).toBe(
        'Auto is light from 7 AM to 7 PM. The switch on the Wall changes it until the next 7 AM or 7 PM. Add a weather place to follow sunrise and sunset.',
      );
    }
  });
});

describe('the Appearance section: what the last save did', () => {
  const statusLine = (props: Partial<Props>) => holding(render(props), 'role="status"');
  const alert = (props: Partial<Props>) => holding(render(props), 'role="alert"');

  it('has one status line, under what Auto does and in the same place whatever happened, so a screen reader has it before it speaks', () => {
    for (const state of EVERY_STATE) {
      const markup = render(state);
      expect(markup.split('role="status"').length - 1, JSON.stringify(state)).toBe(1);
      expect(markup.indexOf('id="appearance-help"'), JSON.stringify(state)).toBeLessThan(markup.indexOf('role="status"'));
    }
  });

  it('says nothing before a save, or while a new choice is on its way', () => {
    expect(statusLine({ status: 'idle' })?.words).toBe('');
    expect(alert({ status: 'idle' })).toBeUndefined();
    expect(render({ status: 'idle' })).not.toContain('Saved.');
  });

  it('says Saved. in the status line once a save has landed, and does not call it a problem', () => {
    expect(statusLine({ status: 'saved' })?.words).toBe('Saved.');
    expect(alert({ status: 'saved' })).toBeUndefined();
  });

  it('says so, as an alert and not as Saved., when a save did not go through', () => {
    expect(alert({ status: 'failed' })?.words).toBe('Could not save. Try again.');
    expect(statusLine({ status: 'failed' })?.words).toBe('');
    expect(render({ status: 'failed' })).not.toContain('Saved.');
  });
});

describe('the Appearance section: its words', () => {
  it('are plain, with no em-dash or en-dash, in every state', () => {
    for (const state of EVERY_STATE) expect(render(state), JSON.stringify(state)).not.toMatch(/[–—]/);
  });
});
