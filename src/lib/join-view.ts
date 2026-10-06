import type { JoinOutcome } from './household-invites';

// What the join page shows: the way in for someone who is not signed in with Google (no session, or a tablet's anonymous one), the
// question to a person who is, and the two ways an invite does not work.
export type JoinView = 'signed-out' | 'signed-in' | 'expired' | 'other-household';

// Where an outcome sends the page: a dead link or another Household stays there and says so; joined, or already in this
// Household, goes to Settings (null).
export function joinViewOf(outcome: JoinOutcome): JoinView | null {
  return outcome === 'joined' ? null : outcome;
}

// What the database said of this link for one account, kept with that account.
export type Refusal = { userId: string; view: 'expired' | 'other-household' };

// The view the page is in: a link that is not a live one is dead whoever is looking; otherwise what the database refused this
// account, if it did, else the question or the way in, by whether the session is a Google account's. A tablet's anonymous session
// is no one, and what was said of another account is not said of this one.
export function joinViewFor({
  token,
  session,
  refused,
}: {
  token: string | null;
  session: { user: { id: string; is_anonymous?: boolean | undefined } } | null;
  refused: Refusal | null;
}): JoinView {
  if (token === null) return 'expired';
  const signedIn = session !== null && session.user.is_anonymous !== true;
  if (!signedIn) return 'signed-out';
  return refused !== null && refused.userId === session.user.id ? refused.view : 'signed-in';
}
