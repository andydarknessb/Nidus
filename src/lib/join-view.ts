import type { JoinOutcome } from './household-invites';

// What the join page shows: the way in for someone who is not signed in with Google (no session, or a tablet's anonymous one), the
// question to a person who is, and the two ways an invite does not work.
export type JoinView = 'signed-out' | 'signed-in' | 'expired' | 'other-household';

// Where an outcome sends the page: a dead link or another Household stays there and says so; joined, or already in this
// Household, goes to Settings (null).
export function joinViewOf(outcome: JoinOutcome): JoinView | null {
  return outcome === 'joined' ? null : outcome;
}
