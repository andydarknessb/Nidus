import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { NotificationsView as NotificationsViewType } from '../src/NotificationsSection';
import type { PushPreferences, pressPerson as pressPersonType } from '../src/lib/push';
import type { Profile } from '../src/lib/profiles';

// The Notifications card (spec 0007, The phone), rendered in each state from what it is told: nothing here reads the browser or
// the database.

let NotificationsView: typeof NotificationsViewType;
let pressPerson: typeof pressPersonType;
beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
  ({ NotificationsView } = await import('../src/NotificationsSection'));
  ({ pressPerson } = await import('../src/lib/push'));
});
afterAll(() => {
  vi.unstubAllEnvs();
});

type Props = Parameters<typeof NotificationsViewType>[0];
const preferences: PushPreferences = { eventReminders: true, reminderMinutes: 30, morningSummary: true, routinesNudge: false, listAdditions: true, people: [] };
const people: Profile[] = [
  { id: 'p-cory', name: 'Cory', color: '#fca5a5', avatar_url: null, sort_order: 1 },
  { id: 'p-sam', name: 'Sam', color: '#6ee7b7', avatar_url: null, sort_order: 2 },
];
const none = () => undefined;
const render = (props: Partial<Props> = {}) =>
  renderToStaticMarkup(
    createElement(NotificationsView, {
      support: 'supported',
      state: { kind: 'off' },
      listName: null,
      busy: false,
      status: 'idle',
      failed: false,
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

  describe('Whose events? (spec 0018)', () => {
    const whose = (markup: string) => /<div role="group" aria-labelledby="whose-label"[\s\S]*?<\/p><\/div>/.exec(markup)?.[0] ?? '';
    const chips = (markup: string) => buttons(whose(markup));
    const pressed = (attributes: string) => /aria-pressed="true"/.test(attributes);

    it('is a group after the morning summary: Everyone with the house disc, then a chip per person, each pressed or not', () => {
      const markup = on({ profiles: people });
      expect(whose(markup)).toMatch(/aria-labelledby="whose-label"/);
      expect(markup).toMatch(/<span id="whose-label"[^>]*>Whose events\?<\/span>/);
      expect(chips(markup).map(({ name }) => name)).toEqual(['Everyone', 'C Cory', 'S Sam']);
      const shown = words(markup);
      expect(shown.indexOf('Morning summary at 7 AM')).toBeLessThan(shown.indexOf('Whose events?'));
      expect(shown.indexOf('Whose events?')).toBeLessThan(shown.indexOf('Routines not done at 7 PM'));
      for (const { attributes } of chips(markup)) expect(attributes).toMatch(/aria-pressed="(true|false)"/);
      // Everyone has the house disc and each person a disc with their initial.
      expect(chips(markup)[0]?.attributes).not.toMatch(/--person/);
      expect(whose(markup)).toMatch(/>C</);
    });

    it('presses Everyone by default and the chosen people otherwise, and draws every chip 48 px tall at least', () => {
      expect(chips(on({ profiles: people })).map(({ attributes }) => pressed(attributes))).toEqual([true, false, false]);
      const chose = on({ state: { kind: 'on', id: 's1', preferences: { ...preferences, people: ['p-sam'] } }, profiles: people });
      expect(chips(chose).map(({ attributes }) => pressed(attributes))).toEqual([false, false, true]);
      for (const { attributes } of chips(chose)) expect(attributes).toMatch(/\bh-13\b/);
    });

    it('says under the chips that events for everyone come to every phone', () => {
      const shown = words(on({ profiles: people }));
      expect(shown).toContain('Events for everyone come to every phone.');
      expect(shown.indexOf('Sam Events for everyone')).toBeGreaterThan(-1);
    });

    it('does not draw a chosen id that is no longer a Profile, and presses Everyone when none is left', () => {
      const gone = on({ state: { kind: 'on', id: 's1', preferences: { ...preferences, people: ['p-gone'] } }, profiles: people });
      expect(chips(gone).map(({ name }) => name)).toEqual(['Everyone', 'C Cory', 'S Sam']);
      expect(chips(gone).map(({ attributes }) => pressed(attributes))).toEqual([true, false, false]);
    });

    it('draws no group while the Household has no Profiles or they are not yet read', () => {
      for (const markup of [on({ profiles: [] }), on({ profiles: null }), on()]) {
        expect(markup).not.toContain('whose-label');
        expect(words(markup)).not.toContain('Events for everyone');
      }
    });

    it('is aria-disabled while a write is on its way', () => {
      expect(chips(on({ profiles: people, busy: true })).every(({ attributes }) => attributes.includes('aria-disabled="true"'))).toBe(true);
    });

    it('presses a person to add or remove them, and removing the last one is Everyone', () => {
      expect(pressPerson([], 'p-cory')).toEqual(['p-cory']);
      expect(pressPerson(['p-cory'], 'p-sam')).toEqual(['p-cory', 'p-sam']);
      expect(pressPerson(['p-cory', 'p-sam'], 'p-cory')).toEqual(['p-sam']);
      expect(pressPerson(['p-sam'], 'p-sam')).toEqual([]);
    });
  });

  it('says what the last tap did, in the status line, and what failed in an alert', () => {
    expect(render({ status: 'saved' })).toMatch(/<p role="status"[^>]*>Saved\.<\/p>/);
    expect(on({ status: 'test' })).toMatch(/<p role="status"[^>]*>Test sent.<\/p>/);
    expect(render()).toMatch(/<p role="status"[^>]*><\/p>/);
    // On the page from the first draw, and out of the layout while empty, as every Settings status line is (#130).
    expect(render()).toMatch(/<p role="status" class="[^"]*\bempty:sr-only\b[^"]*"><\/p>/);
    expect(render()).not.toContain('min-h-6');
    const failed = render({ problem: { place: 'notifications', words: 'Could not turn on notifications. Try again.', n: 1, refused: false } });
    expect(failed).toMatch(/<p[^>]*role="alert"[^>]*>Could not turn on notifications\. Try again\.<\/p>/);
    expect(render({ failed: true })).toMatch(/role="alert"[^>]*>Could not check/);
  });

  it('uses no em-dash, and no glossary word the family would not read', () => {
    const shown = [render(), render({ support: 'unsupported', state: null }), render({ support: 'needs-home-screen', state: null }), render({ state: { kind: 'denied' } }), on()].map(words).join(' ');
    expect(shown).not.toContain('—');
    expect(shown).not.toMatch(/\b(Profiles?|Devices?|Household Accounts?|Push Subscriptions?|Pinned List)\b/);
  });
});
