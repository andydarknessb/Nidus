import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { JoinCard as JoinCardType } from '../src/JoinPage';
import { joinViewFor, joinViewOf, offersSettings, type JoinView } from '../src/lib/join-view';
import { pageOf } from '../src/lib/page-of';

// The join page (spec 0006, The join page): which page a path gets, which view the page is in, what each view says, and where an
// outcome sends it. The views are rendered to markup from what they are told, so that nothing here reads a session or calls the
// database; what the database does with a token is in tests/household-invites.test.ts.

const TOKEN = 'a1b2c3d4'.repeat(8);

beforeAll(() => {
  // The page reaches the Supabase client, which reads these at import; CI has no .env.local.
  vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
});
afterAll(() => {
  vi.unstubAllEnvs();
});

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

describe('which view the join page is in', () => {
  const google = (id: string) => ({ user: { id } });
  const tablet = { user: { id: 'tablet', is_anonymous: true } };

  it("is the way in with no session, and with a tablet's anonymous one", () => {
    expect(joinViewFor({ token: TOKEN, session: null, refused: null })).toBe('signed-out');
    expect(joinViewFor({ token: TOKEN, session: tablet, refused: null })).toBe('signed-out');
  });

  it('is the question with a Google session', () => {
    expect(joinViewFor({ token: TOKEN, session: google('a'), refused: null })).toBe('signed-in');
    expect(joinViewFor({ token: TOKEN, session: { user: { id: 'a', is_anonymous: false } }, refused: null })).toBe('signed-in');
  });

  it('is a dead link with no token, whoever is looking', () => {
    for (const session of [null, tablet, google('a')]) expect(joinViewFor({ token: null, session, refused: null })).toBe('expired');
  });

  it('is what the database refused this account, and not what it refused another', () => {
    const refused = { userId: 'a', view: 'other-household' as const, member: false };
    expect(joinViewFor({ token: TOKEN, session: google('a'), refused })).toBe('other-household');
    expect(joinViewFor({ token: TOKEN, session: google('b'), refused })).toBe('signed-in');
    expect(joinViewFor({ token: TOKEN, session: null, refused })).toBe('signed-out');
  });

  it('offers Settings on a dead link only to an account that already is a Household Account', () => {
    expect(offersSettings('expired', true)).toBe(true);
    expect(offersSettings('expired', false)).toBe(false);
    for (const view of ['signed-out', 'signed-in', 'other-household'] as const) expect(offersSettings(view, true), view).toBe(false);
  });

  it('goes to Settings when the person joined or already was in the Household, and stays to say anything else', () => {
    expect(joinViewOf('joined')).toBeNull();
    expect(joinViewOf('expired')).toBe('expired');
    expect(joinViewOf('other-household')).toBe('other-household');
  });
});

describe('the join page', () => {
  let JoinCard: typeof JoinCardType;
  beforeAll(async () => {
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
  const draw = (view: JoinView, extra: { email?: string | null; member?: boolean; busy?: boolean; problem?: { words: string; n: number } } = {}) =>
    renderToStaticMarkup(
      createElement(JoinCard, { view, email: 'ana@example.com', ...extra, onSignIn: noop, onJoin: noop, onUseAnother: noop, onOpenSettings: noop }),
    );
  const buttons = (markup: string) => words(markup.match(/<button[^>]*>.*?<\/button>/g)?.join('') ?? '');
  // The buttons by their words, each with whether it is inert.
  const inert = (markup: string) =>
    Object.fromEntries([...markup.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map(([, tag, name]) => [name, /aria-disabled="true"/.test(tag!)]));

  it('asks a person who is not signed in to sign in with Google, and offers nothing else', () => {
    const markup = draw('signed-out');
    expect(words(markup)).toEqual([
      'Join a household',
      'Someone has shared their Nidus household with you. Sign in with Google to see its calendar and add to it.',
      'Sign in with Google',
    ]);
    expect(buttons(markup)).toEqual(['Sign in with Google']);
  });

  it('tells a signed-in person which account it is and waits for Join', () => {
    const markup = draw('signed-in');
    expect(words(markup)).toEqual(['Join a household', 'You are signed in as ana@example.com.', 'Join', 'Use another Google account']);
    expect(buttons(markup)).toEqual(['Join', 'Use another Google account']);
    expect(inert(markup)).toEqual({ Join: false, 'Use another Google account': false });
  });

  it('makes Join and Use another Google account inert while the join is on its way', () => {
    expect(inert(draw('signed-in', { busy: true }))).toEqual({ Join: true, 'Use another Google account': true });
  });

  it('says what a join that failed says, as an alert', () => {
    const failed = draw('signed-in', { problem: { words: 'Could not join. Try again.', n: 1 } });
    expect(failed).toContain('role="alert"');
    expect(words(failed)).toContain('Could not join. Try again.');
  });

  it("has one visible heading, the page's own", () => {
    for (const view of ['signed-out', 'signed-in', 'expired', 'other-household'] as const) {
      const markup = draw(view);
      expect(markup.match(/<h1[^>]*>/g), view).toHaveLength(1);
      expect(markup, view).not.toContain('sr-only');
    }
  });

  it('says a dead link no longer works, with no way to join', () => {
    const markup = draw('expired');
    expect(words(markup)).toEqual(['Join a household', 'This invite link no longer works. Ask for a new one.']);
    expect(buttons(markup)).toEqual([]);
  });

  it('adds a primary Open Settings button to a dead link when the account is already a Household Account, with the same words', () => {
    const markup = draw('expired', { member: true });
    expect(words(markup)).toEqual(['Join a household', 'This invite link no longer works. Ask for a new one.', 'Open Settings']);
    expect(buttons(markup)).toEqual(['Open Settings']);
    expect(markup.match(/<button[^>]*>/)?.[0]).toMatch(/\bh-14\b/);
  });

  it('never offers Open Settings to anyone else', () => {
    expect(buttons(draw('expired', { member: false }))).toEqual([]);
    for (const view of ['signed-out', 'signed-in', 'other-household'] as const) expect(buttons(draw(view, { member: true })), view).not.toContain('Open Settings');
  });

  it('says the account has its own household and offers another account', () => {
    const markup = draw('other-household', { email: 'bo@example.com' });
    expect(words(markup)).toContain('bo@example.com already has its own household on Nidus. Use another Google account to join this one.');
    expect(buttons(markup)).toEqual(['Use another Google account']);
  });

  it('starts the sentence with a capital when the account has no address to name', () => {
    expect(words(draw('other-household', { email: null }))).toContain(
      'This Google account already has its own household on Nidus. Use another Google account to join this one.',
    );
    expect(words(draw('signed-in', { email: null }))).toContain('You are signed in as this Google account.');
  });

  it('announces a refusal and lets focus land on it', () => {
    for (const view of ['expired', 'other-household'] as const) {
      const outcome = /<p[^>]*id="join-outcome"[^>]*>/.exec(draw(view))?.[0];
      expect(outcome, view).toMatch(/role="status"/);
      expect(outcome, view).toMatch(/tabindex="-1"/);
    }
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
});

describe('signing in', () => {
  afterEach(() => vi.unstubAllGlobals());

  // What Supabase was asked and where the page went, from a browser at nidus.example.
  async function signIn(from: 'settings' | 'join') {
    const replace = vi.fn();
    vi.stubGlobal('window', { location: { origin: 'https://nidus.example', replace } });
    const { supabase } = await import('../src/lib/supabase');
    const { signInToJoin, signInWithGoogle } = await import('../src/lib/household');
    const spy = vi
      .spyOn(supabase.auth, 'signInWithOAuth')
      .mockResolvedValue({ data: { provider: 'google', url: 'https://accounts.example/go' }, error: null });
    await (from === 'settings' ? signInWithGoogle() : signInToJoin(TOKEN));
    const options = spy.mock.calls[0]?.[0].options;
    spy.mockRestore();
    return { options, replace };
  }

  it('still comes back to Settings from Settings, with nothing else asked', async () => {
    const { options, replace } = await signIn('settings');
    expect(options).toEqual({ redirectTo: 'https://nidus.example/settings' });
    expect(replace).not.toHaveBeenCalled();
  });

  it('comes back to the invite link from the join page, at the account chooser, and leaves by replace', async () => {
    const { options, replace } = await signIn('join');
    expect(options).toEqual({
      redirectTo: `https://nidus.example/join/${TOKEN}`,
      queryParams: { prompt: 'select_account' },
      skipBrowserRedirect: true,
    });
    expect(replace).toHaveBeenCalledWith('https://accounts.example/go');
  });
});
