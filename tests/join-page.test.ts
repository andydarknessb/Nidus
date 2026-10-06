import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { JoinCard as JoinCardType } from '../src/JoinPage';
import { joinViewOf, type JoinView } from '../src/lib/join-view';
import { pageOf } from '../src/lib/page-of';

// The join page (spec 0006, The join page): which page a path gets, what each of its views says, and where an outcome sends it.
// The views are rendered to markup from what they are told, so that nothing here reads a session or calls the database; what the
// database does with a token is in tests/household-invites.test.ts.

const TOKEN = 'a1b2c3d4'.repeat(8);

describe('which page a path gets', () => {
  it('sends /join and everything under it to the join page, a live link or not', () => {
    for (const path of ['/join', '/join/', `/join/${TOKEN}`, '/join/short', `/join/${TOKEN}/more`]) {
      expect(pageOf(path)).toBe('join');
    }
  });

  it('leaves the Wall at / and Settings at /settings as they were', () => {
    expect(pageOf('/')).toBe('wall');
    expect(pageOf('/settings')).toBe('settings');
    expect(pageOf('/settings/calendars')).toBe('settings');
    expect(pageOf('/settings/lists')).toBe('settings');
  });

  it('does not take a path that only starts like a page', () => {
    for (const path of ['/joined', '/joinery/x', '/settingsx', '/somewhere/join/x']) expect(pageOf(path)).toBe('wall');
  });
});

describe('the join page', () => {
  let JoinCard: typeof JoinCardType;
  beforeAll(async () => {
    // The page reaches the Supabase client, which reads these at import; CI has no .env.local.
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key-for-markup-only');
    ({ JoinCard } = await import('../src/JoinPage'));
  });

  const noop = () => undefined;
  // The words as a person reads them: no tags, and none of the comment marks React puts between a sentence's pieces.
  const words = (markup: string) =>
    markup
      .replace(/<!-- -->/g, '')
      .replace(/<[^>]+>/g, '|')
      .split('|')
      .map((piece) => piece.trim())
      .filter(Boolean);
  const draw = (view: JoinView, extra: { email?: string; busy?: boolean; problem?: { words: string; n: number } } = {}) =>
    renderToStaticMarkup(
      createElement(JoinCard, { view, email: extra.email ?? 'ana@example.com', ...extra, onSignIn: noop, onJoin: noop, onUseAnother: noop }),
    );
  const buttons = (markup: string) => words(markup.match(/<button[^>]*>.*?<\/button>/g)?.join('') ?? '');

  it('asks a person who is not signed in to sign in with Google, and offers nothing else', () => {
    const markup = draw('signed-out');
    expect(words(markup)).toEqual([
      'Nidus',
      'Join a household',
      'Someone has shared their Nidus household with you. Sign in with Google to see its calendar and add to it.',
      'Sign in with Google',
    ]);
    expect(buttons(markup)).toEqual(['Sign in with Google']);
  });

  it('tells a signed-in person which account it is and waits for Join', () => {
    const markup = draw('signed-in');
    expect(words(markup)).toEqual(['Nidus', 'Join a household', 'You are signed in as ana@example.com.', 'Join', 'Use another Google account']);
    expect(buttons(markup)).toEqual(['Join', 'Use another Google account']);
    expect(markup).not.toContain('aria-disabled="true"');
  });

  it('makes Join inert while the join is on its way, and says what a join that failed says', () => {
    expect(draw('signed-in', { busy: true })).toContain('aria-disabled="true"');
    const failed = draw('signed-in', { problem: { words: 'Could not join. Try again.', n: 1 } });
    expect(failed).toContain('role="alert"');
    expect(words(failed)).toContain('Could not join. Try again.');
  });

  it('says a dead link no longer works, with no way to join', () => {
    const markup = draw('expired');
    expect(words(markup)).toEqual(['Nidus', 'Join a household', 'This invite link no longer works. Ask for a new one.']);
    expect(buttons(markup)).toEqual([]);
  });

  it('says the account has its own household and offers another account', () => {
    const markup = draw('other-household', { email: 'bo@example.com' });
    expect(words(markup)).toContain('bo@example.com already has its own household on Nidus. Use another Google account to join this one.');
    expect(buttons(markup)).toEqual(['Use another Google account']);
  });

  it('draws every control at least 48 px tall and takes its colours from the tokens', () => {
    for (const view of ['signed-out', 'signed-in', 'other-household'] as const) {
      const markup = draw(view);
      for (const [tag] of markup.matchAll(/<button[^>]*>/g)) expect(tag).toMatch(/\bh-14\b/);
      expect(markup).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|dark:/i);
    }
  });

  it('writes no em-dash in what it says', () => {
    for (const view of ['signed-out', 'signed-in', 'expired', 'other-household'] as const) expect(draw(view)).not.toContain('—');
  });

  it('goes to Settings when the person joined or already was in the Household, and stays to say anything else', () => {
    expect(joinViewOf('joined')).toBeNull();
    expect(joinViewOf('expired')).toBe('expired');
    expect(joinViewOf('other-household')).toBe('other-household');
  });
});

describe('signing in', () => {
  afterEach(() => vi.unstubAllGlobals());

  async function redirectOf(returnTo?: string) {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key-for-markup-only');
    vi.stubGlobal('window', { location: { origin: 'https://nidus.example' } });
    const { supabase } = await import('../src/lib/supabase');
    const { signInWithGoogle } = await import('../src/lib/household');
    const spy = vi.spyOn(supabase.auth, 'signInWithOAuth').mockResolvedValue({ data: { provider: 'google', url: 'https://accounts.example' }, error: null });
    await (returnTo === undefined ? signInWithGoogle() : signInWithGoogle(returnTo));
    const options = spy.mock.calls[0]?.[0].options;
    spy.mockRestore();
    return options?.redirectTo;
  }

  it('still comes back to Settings, and to the join page when that is where it was asked from', async () => {
    expect(await redirectOf()).toBe('https://nidus.example/settings');
    expect(await redirectOf(`/join/${TOKEN}`)).toBe(`https://nidus.example/join/${TOKEN}`);
  });
});
