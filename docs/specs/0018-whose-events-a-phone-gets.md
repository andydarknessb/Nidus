# Nidus v17: whose events a phone gets

Tracker: GitHub issue #286; its sub-issue #287 is the one ticket. Vocabulary: [CONTEXT.md](../../CONTEXT.md) (Household Account, Profile, Push Subscription, Mirrored Calendar, Synced Event, Native Event). Decisions: [PLAN.md](../PLAN.md) ("v17: whose events a phone gets"). Builds on [spec 0007](0007-push-notifications.md) and replaces its ruling "there is no per-person filter". The look: [look.md](../look.md) ("Selected", "The phone").

## Problem Statement

A grown-up's phone gets a reminder before every timed event on the Household's calendar, whoever the event is for. On 2026-10-28 the owner reported reminders for events the Wall draws under another person's disc, and the 7 AM summary lists those events too. Spec 0007 chose this ("Notifications cover the whole Household's calendar, Routines and Pinned List; there is no per-person filter") and put "only for some people's events" out of scope. A Push Subscription has no person, and the sender never reads an event's people: the reminder read and the summary read in `supabase/functions/push-notify/handler.ts` select no Profile column.

Reproduced at the sender's own seam on 2026-10-28, against the local stack with the fake push service: one Household, one phone with event reminders on, one Mirrored Calendar assigned to the Profile Sam, one event ten minutes out. The run sent the phone Sam's event, every run.

## Solution

Each phone chooses whose events it gets, in "Notifications on this phone": Everyone, as today, or one or more people. A phone that chose people gets reminders for, and sees in its 7 AM summary, only the events for one of those people and the events for everyone (an event with nobody picked, or on a calendar assigned to nobody). Every phone starts on Everyone, so nothing changes until someone chooses.

## User Stories

1. As a parent, I want my phone to remind me only of my own events, so that the reminders are worth reading.
2. As a parent who drives the children, I want to choose myself and the children, so that I am reminded of their lessons too.
3. As a parent, I want events for everyone (a family dinner, a calendar assigned to nobody) on my phone whatever I chose, so that household plans reach every phone.
4. As a parent, I want my 7 AM summary to list the events my reminders cover, so that the morning matches the day.
5. As a parent, I want the summary's meals unchanged, so that dinner is still there whoever's events I chose.
6. As a parent with two phones, I want each phone to choose for itself, as each already chooses its kinds of notification.
7. As a parent who has not chosen, I want everything to stay as it is today.
8. As a parent, I want an event that sits on two people's calendars (the same invite in mine and my partner's) to reach both our phones, since the Wall draws both discs.
9. As a parent, I want a Native Event for Sam and Mia to reach the phones that chose Sam or Mia.
10. As a parent who removed a person, I want my phone not to go quiet: a phone whose chosen people are all gone gets everyone's events again.
11. As a parent whose phone is signed in to another Household Account, I want it to start on Everyone, as it already starts with every kind on.
12. As a parent in a Household with no people yet, I want no choice shown, since every event is everyone's.
13. As someone using a screen reader, I want the choice to be a group named "Whose events?" whose chips say whether they are pressed.
14. As a parent, I want the Routines nudge and the list notification unchanged.
15. As a family member at the Wall, I want nothing to change.

## Implementation Decisions

### Rulings

- **Per phone**: the choice belongs to the Push Subscription, beside its four switches (owner, 2026-10-28). There is no link from a Household Account to a Profile.
- **An event's people are the ones the Wall draws**: `calendar_occurrences.profile_ids`. Empty means everyone, the Wall's own rule (`pillPeople` in `src/lib/schedule.ts`). That covers a Synced Event on a calendar assigned to nobody, a Native Event with nobody picked, and a merged event with any copy on a calendar assigned to nobody. A merged event carries every copy's person.
- **One rule, shared by the reminders and the summary**, a pure function: a phone gets an event when the phone's chosen people who are still in the Household are none, or the event's people are none, or the two share a person.
- **Events for everyone reach every phone** (owner, 2026-10-28).
- **The 7 AM summary follows the same rule**; its meals do not change (owner, 2026-10-28). With none of the day's events left for the phone it says "Nothing on the calendar today.", as now. Its key and tag are unchanged; its words are now made per phone.
- **Unchanged**: the Routines nudge, list additions, the test notification, lead times, keys and at-most-once.
- **Replaces** spec 0007's "there is no per-person filter", and takes "only for some people's events" out of its Out of Scope. Reminders per event stay out.

### Data: migration `20261028000001_push_people.sql`

- `push_subscriptions.profile_ids uuid[] not null default '{}'`, check `cardinality(profile_ids) <= 100`. Empty is Everyone. The column joins the `authenticated` select and update column grants; the policies stay as they are (a Household Account's own rows only).
- No foreign key, since an array cannot carry one. The sender keeps only the ids of the Household's current Profiles, so a removed person, or an id from anywhere else, is ignored, and a phone whose every chosen person is gone gets Everyone. A foreign id exposes nothing: the sender only ever reads the phone's own Household.
- `save_push_subscription` is unchanged. A phone that moves to another Household Account has its row deleted and a fresh one inserted, so it starts on `'{}'`; the same account subscribing again keeps its row and its people.

### The sender: `push-notify`

- The subscription read selects `profile_ids`. The reminder read and the summary read of `calendar_occurrences` select `profile_ids`.
- The run reads the Household's Profile ids once per Household when a subscription has reminders or the summary on. The Routines nudge already reads `profiles`; one read may serve both.
- `notificationsFor` skips an event the phone does not get, by the shared rule.
- The summary's day of events and meals is read once per Household as now, and its body is made per subscription from the events that phone gets.

### The phone: `src/lib/push.ts` and `NotificationsSection`

- `PushPreferences` gains `people: string[]` (Profile ids; empty is Everyone) and `DEFAULT_PREFERENCES` has `people: []`. `readPushState` reads `profile_ids`, and `savePushPreferences` writes it with the switches, in the same update.
- `NotificationsSection` reads the Household's Profiles in sort order. In the `on` state, after "Morning summary at 7 AM", it draws a group labelled "Whose events?": an "Everyone" chip with the house disc, then one chip per person with their disc and name. These are the chips of the Add event sheet's "Who is it for?" (`aria-pressed`, at least 48 px, a person's colour only on their own chip). Under the chips: "Events for everyone come to every phone."
- Pressing Everyone clears the choice. Pressing a person adds or removes them, and removing the last one is Everyone. Each press saves at once, as the switches do, one write at a time through the card's write guard, with "Saved." as the status.
- A chosen id that is no longer a Profile in the Household is not drawn, and is dropped by the next save. With every chosen id gone, Everyone is pressed.
- No group when the Household has no Profiles.

## Testing Decisions

- As now: Vitest, the local Supabase stack as a real principal, the push service the only fake, injected as `sendPush`. Never mock the database. A good test asserts what a phone is sent, or what a person sees in the card's markup, never a function's internals.
- **Sender** (`tests/push-notify.test.ts`), the seam the bug was reproduced at, with a fixed `now` and the run scoped by `householdId`. The first test is the repro, written before the fix and seen red: a phone that chose Cory gets no reminder for an event on a calendar assigned to Sam. Then: that phone gets Cory's event; it gets an event on a calendar assigned to nobody; a Native Event for Sam and Mia reaches a phone that chose Mia; an event merged from Cory's and Sam's calendars reaches a phone that chose Cory and a phone that chose Sam, once each; a phone on Everyone gets every event; a phone whose only chosen Profile was deleted gets every event; the morning summary lists only the phone's events and every meal, and two phones in one Household get different bodies; it says "Nothing on the calendar today." when none of the day's events are the phone's. Prior art: the "event reminders" and "the morning summary" blocks, and `arrangeProfile` in the "Routines not done" block.
- **The rule**, as a pure function: Everyone, an event with no people, an overlap, no overlap, chosen ids that are no longer Profiles. Prior art: `tests/push-notify-words.test.ts`.
- **Data** (`tests/push-subscriptions.test.ts`): a new row is `'{}'`; a Household Account reads and updates its own `profile_ids`; another Household Account, a Device and an anonymous session cannot; more than 100 ids are refused; a phone moved to another Household Account starts on `'{}'`; the same account subscribing again keeps its people.
- **Card**, through `renderToStaticMarkup`: the group with Everyone pressed by default; a chosen person pressed and Everyone not; no group with no Profiles; a chosen id that is no longer a Profile is not drawn; the line under the chips. Prior art: `tests/notifications-section.test.ts`.
- No rendered browser check: the card is behind a Household Account's sign-in, and agents do not put a session token into a browser. Cory checks one phone by hand after the deploy.

## Out of Scope

- A link from a Household Account to a Profile ("this is me").
- Choosing people for the Routines nudge or the list notification.
- Reminders per event.
- Choosing people anywhere but the phone's notification card.

## Further Notes

- Found with the diagnosing-bugs loop on 2026-10-28. The hypothesis that held: the behaviour is spec 0007's, since a Push Subscription has no person and the sender reads no event's people. Ruled out: a calendar assigned to the wrong person (the repro fails with every calendar assigned correctly) and a leak between Households (the sender groups subscriptions by Household).
- One ticket, no blockers, one pull request into `master` that closes it.
- Deploy order: push the migration, deploy `push-notify`, then merge. The sender deployed today does not read the new column, so the migration is safe first; the new sender and the new card both need it. The hosted steps are Cory's.
- CONTEXT.md's Push Subscription entry now says it holds whose events the phone gets. No ADR: the change reverses a ruling in a spec, recorded here and in PLAN.md, and reverting it is one migration and one function.
