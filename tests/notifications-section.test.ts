import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { NotificationsView as NotificationsViewType } from '../src/NotificationsSection';
import type { PushPreferences } from '../src/lib/push';

// The Notifications card (spec 0007, The phone), rendered in each state from what it is told: nothing here reads the browser or
// the database.

let NotificationsView: typeof NotificationsViewType;
beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
  ({ NotificationsView } = await import('../src/NotificationsSection'));
});
afterAll(() => {
  vi.unstubAllEnvs();
});

type Props = Parameters<typeof NotificationsViewType>[0];
const preferences: PushPreferences = { eventReminders: true, reminderMinutes: 30, morningSummary: true, routinesNudge: false, listAdditions: true };
const none = () => undefined;
const render = (props: Partial<Props> = {}) =>
  renderToStaticMarkup(
    createElement(NotificationsView, {
      support: 'supported',
      state: { kind: 'off' },
      listName: null,
      busy: false,
      status: 'idle',
      loadProblem: null,
      problem: null,
      onTurnOn: none,
      onTurnOff: none,
      onTest: none,
      onChange: none,
      ...props,
    }),
  );
const on = (props: Partial<Props> = {}) => render({ state: { kind: 'on', id: 's1', preferences }, ...props });

const words = (markup: string) => markup.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
const buttons = (markup: string) => [...markup.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attributes, inner]) => ({ attributes: attributes ?? '', name: words(inner ?? '') }));
const checkboxes = (markup: string) => [...markup.matchAll(/<label[^>]*>(<input[^>]*type="checkbox"[^>]*\/?>[\s\S]*?)<\/label>/g)].map(([, inner]) => ({ input: /<input[^>]*>/.exec(inner ?? '')?.[0] ?? '', name: words(inner ?? '') }));

describe('the Notifications card', () => {
  it('is titled "Notifications on this phone"', () => {
    expect(words(render())).toMatch(/^Notifications on this phone /);
    expect(render()).toMatch(/<h2[^>]*>Notifications on this phone<\/h2>/);
  });

  it('says what an unsupported browser cannot do, and offers nothing', () => {
    const markup = render({ support: 'unsupported', state: null });
    expect(words(markup)).toContain('This browser cannot show notifications from Nidus.');
    expect(buttons(markup)).toEqual([]);
  });

  it('tells an iPhone browser tab to add Nidus to the Home Screen, in the spec\'s words, and offers nothing', () => {
    const markup = render({ support: 'needs-home-screen', state: null });
    expect(words(markup)).toContain('On iPhone, notifications need Nidus on your Home Screen. In Safari, tap Share, then Add to Home Screen, then open Nidus from the new icon and come back here.');
    expect(buttons(markup)).toEqual([]);
  });

  it('offers to turn on, with one primary button, when off', () => {
    const markup = render();
    expect(words(markup)).toContain('Get reminders and updates on this phone, even when Nidus is closed.');
    const found = buttons(markup);
    expect(found.map(({ name }) => name)).toEqual(['Turn on notifications']);
    expect(found[0]?.attributes).toMatch(/class="[^"]*\bbg-primary\b/);
  });

  it('says what to do when blocked, and offers nothing', () => {
    const markup = render({ state: { kind: 'denied' } });
    expect(words(markup)).toContain("Notifications are blocked for Nidus on this phone. Allow them in the phone's settings, then come back here.");
    expect(buttons(markup)).toEqual([]);
  });

  it('draws nothing but the title while the first read is on its way', () => {
    expect(words(render({ state: null }))).toBe('Notifications on this phone');
  });

  describe('when on', () => {
    it('has four labelled checkboxes, in the spec\'s words, each as the preferences say', () => {
      const found = checkboxes(on());
      expect(found.map(({ name }) => name)).toEqual(['Event reminders', 'Morning summary at 7 AM', 'Routines not done at 7 PM', 'Added to the shopping list']);
      expect(found.map(({ input }) => /\bchecked=""/.test(input))).toEqual([true, true, false, true]);
    });

    it('names the pinned list when it has a name', () => {
      expect(words(on({ listName: 'Groceries' }))).toContain('Added to Groceries');
      expect(words(on({ listName: 'Groceries' }))).not.toContain('the shopping list');
    });

    it('has a labelled select of the five lead times, the saved one chosen', () => {
      const markup = on();
      expect(markup).toMatch(/<label[^>]*><span[^>]*>How long before<\/span><select[^>]*>/);
      const options = [...markup.matchAll(/<option value="(\d+)"( selected="")?>(\d+) minutes<\/option>/g)].map(([, value, selected]) => [value, selected !== undefined]);
      expect(options).toEqual([['5', false], ['10', false], ['15', false], ['30', true], ['60', false]]);
    });

    it('ends with Send a test, then a quiet Turn off notifications, after the line about the lock screen', () => {
      const markup = on();
      const found = buttons(markup);
      expect(found.map(({ name }) => name)).toEqual(['Send a test', 'Turn off notifications']);
      expect(found[1]?.attributes).toMatch(/class="[^"]*\btext-muted-foreground\b/);
      expect(found[1]?.attributes).not.toMatch(/bg-primary/);
      const shown = words(markup);
      expect(shown).toContain('Notifications can show event names on your lock screen.');
      expect(shown.indexOf('lock screen')).toBeLessThan(shown.indexOf('Send a test'));
    });

    it('draws every control 48 px tall at least', () => {
      const markup = on();
      for (const { input } of checkboxes(markup)) expect(input).toMatch(/\bsize-full\b/);
      expect(markup.match(/<label class="[^"]*\bmin-h-12\b/g)).toHaveLength(4);
      for (const { attributes } of buttons(markup)) expect(attributes).toMatch(/\bh-14\b/);
      expect(markup).toMatch(/<select[^>]*class="[^"]*\bh-14\b/);
    });

    it('is aria-disabled while a write is on its way, and never disabled, which would drop the focus', () => {
      const busy = on({ busy: true });
      expect(buttons(busy).every(({ attributes }) => attributes.includes('aria-disabled="true"'))).toBe(true);
      expect(busy.match(/aria-disabled="true"/g)).toHaveLength(2 + 4 + 1);
      for (const markup of [busy, on(), render()]) expect(markup).not.toMatch(/\sdisabled(=|\s|>)/);
      expect(on()).not.toContain('aria-disabled=');
    });
  });

  it('says what the last tap did, in the status line, and what failed in an alert', () => {
    expect(render({ status: 'saved' })).toMatch(/<p role="status"[^>]*>Saved<\/p>/);
    expect(on({ status: 'test' })).toMatch(/<p role="status"[^>]*>Test sent<\/p>/);
    expect(render()).toMatch(/<p role="status"[^>]*><\/p>/);
    const failed = render({ problem: { place: 'notifications', words: 'Could not turn on notifications. Try again.', n: 1, refused: false } });
    expect(failed).toMatch(/<p[^>]*role="alert"[^>]*>Could not turn on notifications\. Try again\.<\/p>/);
    expect(render({ loadProblem: 'Could not check notifications on this phone. Check your connection.' })).toMatch(/role="alert"[^>]*>Could not check/);
  });

  it('uses no em-dash, and no glossary word the family would not read', () => {
    const shown = [render(), render({ support: 'unsupported', state: null }), render({ support: 'needs-home-screen', state: null }), render({ state: { kind: 'denied' } }), on()].map(words).join(' ');
    expect(shown).not.toContain('—');
    expect(shown).not.toMatch(/\b(Profiles?|Devices?|Household Accounts?|Push Subscriptions?|Pinned List)\b/);
  });
});
