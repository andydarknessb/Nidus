import type { HouseholdInvite } from './household-invites';

// What the Who can sign in card decides, apart from how it is drawn: pure, so a test needs no Supabase client.

// What the invite is, for the screen: none waiting, a link just made (the only time it can be shown: the database keeps its hash
// and nothing else), or one waiting that was made before this screen was opened.
export type InviteView = { kind: 'none' } | { kind: 'made'; link: string; expiresAt: Date } | { kind: 'waiting'; expiresAt: Date };

// The line the share sheet carries with the link.
export const SHARE_TEXT = 'Join our household on Nidus';

// What an invite that could not be made or cancelled says, each with its own words (a removal says the default ones, as unpairing does).
export const MAKE_SAID = { failed: 'Could not make the link. Try again.', offline: 'No internet, so the link was not made. Try again soon.' };
export const CANCEL_SAID = { failed: 'Could not cancel the invite. Try again.', offline: 'No internet, so the invite was not cancelled. Try again soon.' };

// What the invite area draws: the link just made, else the one the database holds, else none; null until the first read lands.
export function inviteViewOf(made: { link: string; expiresAt: Date } | null, stored: HouseholdInvite | null | undefined): InviteView | null {
  if (made) return { kind: 'made', ...made };
  if (stored === undefined) return null;
  return stored ? { kind: 'waiting', expiresAt: stored.expiresAt } : { kind: 'none' };
}

// What the share sheet is given: the link, with the line that goes with it.
export const sharePayload = (link: string) => ({ url: link, text: SHARE_TEXT });
