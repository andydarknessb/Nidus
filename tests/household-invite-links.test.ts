import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The pure half of the Household Invite client: the link a Household Account shares and the token the join page reads
// back from it. The module builds the Supabase client on import, so a placeholder URL and key are stubbed first.
let inviteLink: typeof import('../src/lib/household-invites').inviteLink;
let joinTokenOf: typeof import('../src/lib/household-invites').joinTokenOf;

beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
  ({ inviteLink, joinTokenOf } = await import('../src/lib/household-invites'));
});
afterAll(() => {
  vi.unstubAllEnvs();
});

const TOKEN = '0123456789abcdef'.repeat(4);

describe('inviteLink', () => {
  it('is the origin, /join/ and the token', () => {
    expect(inviteLink('https://nidus.example', TOKEN)).toBe(`https://nidus.example/join/${TOKEN}`);
  });

  it('is read back by joinTokenOf from its path', () => {
    expect(joinTokenOf(new URL(inviteLink('https://nidus.example', TOKEN)).pathname)).toBe(TOKEN);
  });
});

describe('joinTokenOf', () => {
  it('reads a /join/ path with a 64-character lowercase hex token', () => {
    expect(joinTokenOf(`/join/${TOKEN}`)).toBe(TOKEN);
  });

  it.each([
    ['uppercase hex', `/join/${TOKEN.toUpperCase()}`],
    ['a short token', `/join/${TOKEN.slice(1)}`],
    ['a long token', `/join/${TOKEN}0`],
    ['a trailing slash', `/join/${TOKEN}/`],
    ['non-hex characters', `/join/${'g'.repeat(64)}`],
    ['no token', '/join/'],
    ['no token or slash', '/join'],
    ['a query string left on', `/join/${TOKEN}?x=1`],
    ['a deeper path', `/join/${TOKEN}/more`],
    ['a prefix before it', `/app/join/${TOKEN}`],
    ['another page', '/settings'],
    ['the Wall', '/'],
  ])('is null for %s', (_name, pathname) => {
    expect(joinTokenOf(pathname)).toBeNull();
  });
});
