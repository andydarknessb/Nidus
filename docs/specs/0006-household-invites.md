# Nidus v6: inviting another grown-up

Tracker: GitHub issue #120; its sub-issues are the tickets. Vocabulary: [CONTEXT.md](../../CONTEXT.md) (Household Account, Household Invite). Decisions: [PLAN.md](../PLAN.md) (v6 section). The look: [look.md](../look.md); every new screen is a `/settings`-style phone screen built from `@/components/phone`.

## Problem Statement

A Household has one sign-in: the Google account that made it. A second parent who wants to add events or change Settings from their own phone has two ways in today, and both fall short. Pairing their phone as if it were a tablet gives them no Settings and ends whenever they clear the browser. Signing in with the owner's Google account means sharing a password. The schema already lets a Household have several Household Accounts (`household_accounts` is keyed by the auth user, not the Household, and every policy goes through `current_household_id()` and `is_household_account()`). What is missing is a safe way to add one.

## Solution

A Household Account makes an invite link in Settings and sends it to the other grown-up however they like (Messages, WhatsApp, email). That person opens the link on their phone, signs in with their own Google account, taps Join, and is a Household Account of the same Household, with the same rights as the person who invited them. Settings lists everyone who can sign in, and any of them can remove anyone else.

## User Stories

1. As a parent, I want to invite my partner from Settings, so that they can add events and change Settings from their own phone with their own Google account.
2. As a parent, I want to send the invite as a link through any app on my phone, so that I do not have to type an email address into Nidus.
3. As a parent, I want an invite link to work once and stop after a week, so that a link that ends up in the wrong place does little harm.
4. As a parent, I want to cancel an invite I have sent, so that a link I sent by mistake stops working.
5. As the person invited, I want to see what I am joining and which Google account I am joining with before anything happens, so that I do not join with the wrong account.
6. As the person invited, I want a plain message when the link no longer works, so that I know to ask for a new one.
7. As the person invited, if my Google account already has its own Nidus household, I want to be told so and to be able to use another account, so that nothing of mine is lost or moved.
8. As a parent, I want to see everyone who can sign in to our household, so that I know who has access.
9. As a parent, I want to remove someone who should no longer have access, so that they can no longer open Settings or the calendar.
10. As a family member on the Wall's tablet, I want nothing to change, so that the Wall works as it did.

## Implementation Decisions

### Rulings

- **Equal**: every Household Account has the same rights. There is no owner, no admin and no role column. The first account is not special.
- **No leaving, no removing yourself**: a Household Account may remove any other Household Account of its Household, never itself, so a Household always keeps at least one. Signing out is how you stop using Nidus on a phone.
- **One invite at a time** per Household. Making a new link replaces the old one, which stops working. An invite lasts 7 days and works once.
- **A Google account belongs to one Household**: joining is refused when the caller is already a Household Account of another Household, with a way to sign in with another account. Moving or merging Households is out of scope. When the caller already belongs to the inviting Household, joining succeeds and the invite stays unspent.
- **An empty Household is given up on joining** (#126): when the caller's own Household holds nothing of anyone's (no other Household Account, no Device, Profile, Calendar Account, Native Event, Routine or Meal, no waiting invite, at most one Shared List and no list item), joining deletes it and the caller joins the inviting Household, in one transaction with both Households locked. Its settings (name, time zone, Appearance, weather place) go with it. This is how someone who opened `/settings` before tapping Join, or who was removed and signed in again, can still be invited. A Household with anything in it is refused exactly as before.
- **No email is sent** and nothing is asked of the inviter but a tap: the link is the invite, and the phone's share sheet sends it.
- **Removing someone** deletes their `household_accounts` row and cancels the Household's waiting invite (so a removed account cannot come back by a link it made before), and nothing else. What they added stays, and so do the Calendar Accounts they connected and the tablets they paired. Their session keeps working only as a stranger's: `current_household_id()` is null for them at once. If they sign in to `/settings` again, `ensure_household` makes them a new, empty Household, as it does for anyone.

### Data: migration `20261019000001_household_invites.sql`

- `household_invites`: `household_id` uuid primary key, references `households` on delete cascade (one per Household); `token_hash` text not null unique (SHA-256 hex of the token, via `extensions.digest`); `created_at` timestamptz not null default now(); `expires_at` timestamptz not null. RLS on. `authenticated` may select `household_id`, `created_at` and `expires_at` only, under a policy `is_household_account() and household_id = current_household_id()`. No insert, update or delete grant: the RPCs write. A Device reads nothing. `token_hash` is never readable by a client.
- The token is 32 random bytes as 64 lowercase hex characters (`extensions.gen_random_bytes`). Only its hash is stored; the plain token is returned once, by the RPC that makes it.
- RPCs, all `security definer`, `set search_path = ''`, execute granted to `authenticated` only and revoked from `public` and `anon`, in the style of `claim_pairing_code`:
  - `create_household_invite()` returns `(token text, expires_at timestamptz)`. Household Account only. Upserts the Household's row with a fresh token and `expires_at = now() + interval '7 days'`.
  - `cancel_household_invite()` returns void. Household Account only. Deletes the Household's row; no row is not an error.
  - `accept_household_invite(p_token text)` returns uuid (the Household). Refuses an anonymous session the way `ensure_household` does. A malformed, unknown, expired, replaced, cancelled or spent token is one refusal, SQLSTATE `PT410`, so a caller cannot tell them apart. A caller who is a Household Account of another Household is a second refusal, `PT409`. (PostgREST answers a `PTxxx` code with that HTTP status.) A caller already in the inviting Household gets the Household's id and the invite is left in place. Otherwise the invite is spent and the link made in one statement (`delete ... where token_hash = ... and expires_at > now() returning household_id`, then the insert), so two people racing one link cannot both join.
  - `household_account_list()` returns `(auth_user_id uuid, email text, created_at timestamptz)`, oldest first: the caller's Household's accounts with their email from `auth.users`. Household Account only. A Device and an anonymous session are refused.
  - `remove_household_account(p_auth_user_id uuid)` returns boolean. Household Account only. Locks the Household's `households` row (`for update`), re-checks after the lock that the caller is still one of its Household Accounts, deletes the target when it is another account of the same Household (false when nothing matched), and deletes the Household's invite. The lock makes two accounts removing each other at once end with one left, never none. `create_household_invite` takes the same lock and re-check, so a removal and a new link cannot cross.
- Grants on `household_accounts`: `anon` and `authenticated` held Supabase's default privileges, refused only by row-level security. Revoke all from both and grant `authenticated` select only (its existing "reads its own link" policy). Every write is a security definer function.
- No Realtime: Settings re-reads after its own writes. No change to `current_household_id()`, `is_household_account()`, `ensure_household` or any existing policy.

### The client: `src/lib/household-invites.ts`

One module, the only place the UI reaches this data. Its interface is fixed so the two screens can be built at once:

```ts
export type HouseholdInvite = { createdAt: Date; expiresAt: Date };
export type HouseholdAccountRow = { authUserId: string; email: string; createdAt: Date };
export type JoinOutcome = 'joined' | 'expired' | 'other-household';

export function inviteLink(origin: string, token: string): string;      // `${origin}/join/${token}`
export function joinTokenOf(pathname: string): string | null;            // '/join/<64 lowercase hex>' only, else null
export async function readHouseholdInvite(householdId: string): Promise<HouseholdInvite | null>; // null when none or expired
export async function createHouseholdInvite(): Promise<{ token: string; expiresAt: Date }>;
export async function cancelHouseholdInvite(): Promise<void>;
export async function acceptHouseholdInvite(token: string): Promise<JoinOutcome>; // 'expired' covers every dead link
export async function listHouseholdAccounts(): Promise<HouseholdAccountRow[]>;
export async function removeHouseholdAccount(authUserId: string): Promise<void>;
```

Any other failure throws, as the existing `src/lib/device.ts` functions do.

### Settings: "Who can sign in"

- A new `HouseholdAccountsSection` (`src/HouseholdAccountsSection.tsx`), placed in `SettingsPage` after the tablets section and before Sign out, built like `DevicesSection` (Card, Field, Confirm, Problem, `buttonRow`, `buttonHalf`, one write at a time with `aria-disabled`).
- Card title "Who can sign in". One row per account: the email, "You" beside the signed-in account's own, and "Since {date}" (the Household Timezone's date). Every row but your own opens to a Remove button; Confirm asks "Remove {email}? They will no longer be able to open Settings or the calendar with this Google account." with "Remove" and "Cancel".
- Below the list, the invite:
  - No invite waiting: a secondary "Invite someone" button, full width.
  - Just made: a read-only Field "Invite link" holding the link, the line "Send this link to one person. It works once, until {date}.", then "Share" (only when `navigator.share` exists; it shares the link with the text "Join our household on Nidus") and "Copy" (`navigator.clipboard.writeText`; status "Copied"), then a quiet "Cancel invite".
  - Waiting but not on screen (after a reload): "An invite is waiting, until {date}." with "Make a new link" and "Cancel invite". The old link cannot be shown again; it is not stored.
  - After a cancel: status "Invite cancelled." and back to "Invite someone".
- Dates are written as the rest of Settings writes them, in the Household Timezone.

### The join page: `/join/<token>`

- `App.tsx` sends `/join/...` to a new `JoinPage` (`src/JoinPage.tsx`) instead of the Wall; `joinTokenOf` reads the token. A path that is not `/join/<64 hex>` shows the dead-link state.
- It is drawn as `/settings` is (the same frame, mode handling and Card), phone first. Title "Join a household".
- States:
  - Not signed in, or an anonymous (tablet) session: "Someone has shared their Nidus household with you. Sign in with Google to see its calendar and add to it." and "Sign in with Google", which signs in with `redirectTo` this same `/join/<token>` URL. The tablet session on that browser is replaced by the sign-in; its Device stays listed in Settings to be unpaired there.
  - Signed in with Google: "You are signed in as {email}." with "Join" (primary) and "Use another Google account" (signs out and stays on the page). Nothing is joined before "Join" is tapped.
  - Joined, or already in this Household: go to `/settings` with `location.replace`, so the token leaves the history.
  - `expired`: "This invite link no longer works. Ask for a new one."
  - `other-household`: "{email} already has its own household on Nidus. Use another Google account to join this one." with "Use another Google account".
- `netlify.toml` gains a `[[headers]]` block for `/join/*` with `Referrer-Policy = "no-referrer"`, so the token never travels in a Referer header. The SPA fallback already serves the route; the hosted and local Auth redirect allow-lists already allow `/**`.

### Testing Decisions

- Tests run as they do now: Vitest, the local Supabase stack as a real principal through `tests/support/supabase.ts` (`createHousehold`, `asHouseholdAccount`, `asDevice`, `asTablet`, `createSignedUpAccount`, `signInAs`), components through `renderToStaticMarkup` with the `vi.stubEnv` then `await import` pattern. No new tooling, no mocked database.
- Through the seam (`tests/household-invites.test.ts`): a Household Account makes an invite and gets a 64-hex token; a Device and an anonymous session cannot make, cancel, read or accept one, nor list or remove accounts; `token_hash` cannot be selected; a signed-up account accepts and then reads, updates and pairs a tablet for the same Household; the token works once (a second account is refused); a replaced, cancelled and expired (set by the service role) token is each refused with the same SQLSTATE; a Household Account of another Household is refused with the other SQLSTATE and stays in its own Household; a member of the inviting Household succeeds and leaves the invite unspent; the list shows both accounts' emails oldest first and never another Household's; A removes B and B then reads nothing; B's invite made before removal no longer works; A and B removing each other at once leaves one; nobody can remove themselves or an account of another Household; insert, update and delete on `household_accounts` stay refused for `anon` and `authenticated`.
- Pure, with unit tests: `joinTokenOf` (valid, uppercase, short, long, trailing slash, other paths) and `inviteLink`.
- Through `renderToStaticMarkup`: the section with two accounts ("You" on one row only, Remove offered on the other), each invite state, Share present only when sharing is possible; the join page's five states.
- Screens are checked by eye at 390 by 844 in both modes with a dev server on the local stack. Agents do not put a session token into a browser; they render the real components to static markup against the built CSS, as v4 did.

## Out of Scope

- Roles or limited accounts (a grown-up who may add events but not change Settings: pair their phone as a tablet for that).
- Leaving a Household, transferring it, or moving a Google account between Households.
- Sending invites by email or text from Nidus; inviting by email address.
- More than one invite waiting at a time.
- Telling the Wall or other phones live when an account is added or removed.

## Further Notes

- The Wall is untouched: a Device's rights, the Pairing Code and the tablet screens do not change.
- Known limits: an invited person who opens `/settings` before tapping Join gets an empty Household of their own (`ensure_household`); since #126 that Household is given up when they join. A calendar-connect link made before someone was removed stays usable for its 7 days; its calendars arrive unselected. Both are follow-up issues.
- Built in parallel with v5 (iPhone calendars, spec 0005). They meet in CONTEXT.md, PLAN.md and CLAUDE.md only; whichever merges second rebases those lines.
