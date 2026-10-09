import { afterEach, describe, expect, it } from 'vitest';
import {
  acceptHouseholdInvite,
  cancelHouseholdInvite,
  createHouseholdInvite,
  inviteLink,
  isHouseholdAccount,
  joinTokenOf,
  listHouseholdAccounts,
  readHouseholdInvite,
  removeHouseholdAccount,
} from '../src/lib/household-invites';
import {
  asHouseholdAccount,
  asServiceRole,
  createHousehold,
  createSignedUpAccount,
  destroyHousehold,
  destroySignedUpAccount,
  signInAs,
  type HouseholdAccount,
  type SignedUpAccount,
} from './support/supabase';

// The pure half of the Household Invite client: the link a Household Account shares and the token the join page reads
// back from it.

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

// The other half: the client lib acting as each principal of the seam, against the local stack.
describe('the household invite client lib', () => {
  const households: HouseholdAccount[] = [];
  const newcomers: SignedUpAccount[] = [];

  afterEach(async () => {
    await Promise.all(newcomers.splice(0).map(destroySignedUpAccount));
    await Promise.all(households.splice(0).map(destroyHousehold));
  });

  async function household(name: string) {
    const arranged = await createHousehold(name);
    households.push(arranged);
    return { arranged, phone: await asHouseholdAccount(arranged), id: arranged.household.id };
  }

  it('makes the invite, reads it back without its token, and cancels it', async () => {
    const mine = await household('The Andersons');
    expect(await readHouseholdInvite(mine.phone, mine.id)).toBeNull();

    const { token, expiresAt } = await createHouseholdInvite(mine.phone);

    expect(joinTokenOf(new URL(inviteLink('https://nidus.example', token)).pathname)).toBe(token);
    expect(await readHouseholdInvite(mine.phone, mine.id)).toMatchObject({ expiresAt });
    await cancelHouseholdInvite(mine.phone);
    expect(await readHouseholdInvite(mine.phone, mine.id)).toBeNull();
  });

  it("keeps another Household's invite and accounts from a Household Account: nothing read, nothing removed", async () => {
    const mine = await household('The Andersons');
    const neighbours = await household('The Nguyens');
    await createHouseholdInvite(mine.phone);

    expect(await readHouseholdInvite(neighbours.phone, mine.id)).toBeNull();
    expect(await listHouseholdAccounts(neighbours.phone)).toMatchObject([{ authUserId: neighbours.arranged.authUserId }]);
    expect(await removeHouseholdAccount(neighbours.phone, mine.arranged.authUserId)).toBe(false);
    expect(await removeHouseholdAccount(neighbours.phone, neighbours.arranged.authUserId)).toBe(false);
    expect(await listHouseholdAccounts(mine.phone)).toMatchObject([{ authUserId: mine.arranged.authUserId }]);
  });

  it('lets a newcomer join once by the link, refuses a spent one, and refuses an account of another Household', async () => {
    const mine = await household('The Andersons');
    const neighbours = await household('The Nguyens');
    const arranged = await createSignedUpAccount();
    newcomers.push(arranged);
    const guest = await signInAs(arranged);
    expect(await isHouseholdAccount(guest)).toBe(false);

    const { token } = await createHouseholdInvite(mine.phone);
    expect(await acceptHouseholdInvite(guest, token)).toBe('joined');
    expect(await isHouseholdAccount(guest)).toBe(true);
    expect(await acceptHouseholdInvite(guest, token)).toBe('expired');

    // A Household with nothing in it is given up on joining; one with a person in it is not.
    await asServiceRole().from('profiles').insert({ household_id: neighbours.id, name: 'Sam', color: '#ffd166' });
    const fresh = await createHouseholdInvite(mine.phone);
    expect(await acceptHouseholdInvite(neighbours.phone, fresh.token)).toBe('other-household');

    expect(await removeHouseholdAccount(mine.phone, arranged.authUserId)).toBe(true);
    expect(await isHouseholdAccount(guest)).toBe(false);
  });
});
