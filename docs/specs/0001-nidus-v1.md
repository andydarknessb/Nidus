# Nidus v1 — wall-mounted household calendar

Vocabulary: [CONTEXT.md](../../CONTEXT.md). Decisions: [PLAN.md](../PLAN.md), ADR [0001](../adr/0001-supabase-over-custom-backend.md), ADR [0002](../adr/0002-read-only-calendar-mirror.md).

## Problem Statement

Our household's schedule is spread across several Google accounts and calendars. Nobody can see the whole week at a glance without opening a phone, kids can't see what's expected of them each morning, and the grocery list lives in whoever's head last thought about it. Commercial wall calendars exist but are subscription-priced, tied to their own apps, and give no control over what is shown or how.

## Solution

Nidus is a web app that runs full-screen on an Android tablet mounted on the wall. It shows the next five days of every Google calendar the parents choose to mirror, colour-coded by the family member each calendar belongs to, together with each person's daily Routines and a pinned Shared List. Anyone walking past can tick a routine, cross off a grocery, or add a one-off Native Event. Parents administer everything from a phone: connect Google accounts, pick calendars, manage Profiles, and pair tablets with a short code. Google remains the place where real calendar events are edited; Nidus never writes to it.

## User Stories

### Household and sign-in

1. As a parent, I want to sign in with my Google account, so that I don't have to manage another password.
2. As a parent signing in for the first time, I want a Household created for me automatically with a name and timezone, so that I can start configuring immediately.
3. As a parent, I want to set the Household Timezone once, so that every date, midnight reset and "today" boundary is consistent regardless of which calendar an event came from.
4. As a parent, I want to rename the Household, so that the display can show our family name.
5. As the Household Account, I want administration screens to be usable on a phone, so that I never have to do setup on the wall tablet.
6. As a parent, I want to sign out on my phone, so that a lost phone does not keep admin access.

### Profiles

7. As a parent, I want to add a Profile for each family member with a name and colour, so that events and routines can be attributed to people.
8. As a parent, I want to reorder Profiles, so that the routine rail shows the kids in the order we think of them.
9. As a parent, I want to edit a Profile's name, colour and optional avatar, so that the display stays accurate as things change.
10. As a parent, I want to delete a Profile, so that a departed babysitter's colour stops appearing; their Mirrored Calendars fall back to whole-household attribution and their Routines are removed.
11. As a family member, I want my colour to be used consistently on events, routine headers and native event chips, so that I can find my things at a glance from five feet away.

### Device pairing

12. As a parent setting up a tablet, I want the tablet to display a short pairing code when it is not yet paired, so that I don't have to type credentials on a wall.
13. As a parent, I want to enter that code on my phone and approve it, so that the tablet becomes a Device of our Household.
14. As a parent, I want a pairing code to expire after a few minutes if unclaimed, so that a stale code on a tablet can't be claimed later.
15. As a parent, I want to name each Device (Kitchen, Hallway), so that I can tell them apart in settings.
16. As a parent, I want to see when each Device was last seen, so that I know the kitchen tablet is still online.
17. As a parent, I want to revoke a Device, so that a tablet we no longer own immediately stops showing our data.
18. As a Device, I want my session to survive tablet restarts and app reloads indefinitely, so that the wall never shows a login screen.
19. As a Device that has been revoked, I want to return to the pairing screen, so that the tablet can be re-paired rather than showing stale data or errors.
20. As a parent, I want a Device to be unable to reach any administration screen, so that a child on the tablet cannot disconnect a calendar or delete a Profile.

### Calendar Accounts and Mirrored Calendars

21. As a parent, I want to connect my Google account as a Calendar Account with read-only calendar access, so that my events appear on the wall.
22. As a second adult, I want to connect my own Google account from my own phone via a link the Household Account sends me, so that my calendars can be mirrored without sharing my password or signing in to Nidus.
23. As a parent, I want the identity sign-in and the calendar consent to be separate steps, so that signing in never asks for more Google access than it needs.
24. As a parent, I want to see the list of calendars inside each Calendar Account, so that I can choose which ones to mirror.
25. As a parent, I want to select and deselect individual calendars as Mirrored Calendars, so that my work calendar's 1:1s don't clutter the family wall.
26. As a parent, I want to assign each Mirrored Calendar to one Profile or to the whole household, so that its events take that person's colour.
27. As a parent, I want to override a Mirrored Calendar's display colour, so that the wall matches our Profile colours rather than Google's.
28. As a parent, I want to see when each Calendar Account last synced successfully, so that I can tell whether the wall is current.
29. As a parent, I want to be told when a Calendar Account needs re-authorisation, so that I can fix it from my phone.
30. As a parent, I want to re-authorise a Calendar Account without recreating its Mirrored Calendars and assignments, so that fixing an expired token is one tap.
31. As a parent, I want to remove a Calendar Account, so that a departed household member's events disappear along with their token.
32. As a parent, I want deselecting a Mirrored Calendar to remove its events from the wall immediately, so that I don't wait for the next sync.

### Synced Events

33. As a family member, I want changes made on my phone in Google Calendar to appear on the wall within about five minutes, so that the wall is trustworthy.
34. As a family member, I want recurring events to appear on every occurrence, so that weekly piano lessons show every week.
35. As a family member, I want a cancelled or deleted Google event to disappear from the wall, so that we don't turn up to things that aren't happening.
36. As a family member, I want a single cancelled occurrence of a recurring event to disappear while the rest remain, so that "no piano this week" is reflected.
37. As a family member, I want moved or renamed events to update in place, so that the wall never shows both the old and new time.
38. As a family member, I want all-day events shown in a distinct all-day band, so that birthdays don't look like they happen at midnight.
39. As a family member, I want multi-day events to appear on each day they span, so that a holiday shows across the whole trip.
40. As a family member, I want events shown in the Household Timezone even when the source calendar uses another, so that a work calendar set to another zone is not misleading.
41. As a family member, I want events from the past month and the next six months available, so that the week and day views can page around without gaps.
42. As a family member, I want Synced Events to be uneditable on the wall, so that nobody accidentally believes they've changed a Google event.
43. As a parent, I want a full resync to happen automatically when Google invalidates the incremental sync token, so that the wall recovers without my intervention.
44. As a parent, I want a resync to replace a calendar's events atomically, so that the wall never shows a half-empty calendar mid-sync.
45. As a family member, I want a small "last synced N hours ago" badge to appear only when a Calendar Account is more than an hour behind, so that a healthy wall stays uncluttered but a broken one is obvious.

### Native Events

46. As a family member at the tablet, I want to add a one-off Native Event with a title, date, start and end (or all-day), so that "plumber coming Thursday 2pm" is on the wall in ten seconds.
47. As a family member, I want to assign a Native Event to zero or more Profiles, so that it takes the right colours; zero means the whole household.
48. As a family member, I want to add an optional location and notes to a Native Event, so that the wall carries the address.
49. As a family member, I want to edit or delete a Native Event from the tablet, so that mistakes are fixed where they were made.
50. As a family member, I want Native Events visibly distinguishable from Synced Events, so that I know which ones live only on the wall.
51. As a parent, I want Native Events to be creatable and editable from my phone too, so that I can add things while out.

### Routines

52. As a parent, I want to create a Routine for a Profile with a title and a days-of-week schedule, so that "pack school bag" appears Monday to Friday only.
53. As a parent, I want to reorder a Profile's Routines, so that the morning list reads top to bottom in the order things happen.
54. As a parent, I want to archive a Routine rather than delete it, so that its completion history survives.
55. As a child at the tablet, I want to see only today's Routines for me, grouped under my name and colour, so that I know what's expected this morning.
56. As a child, I want to tap a Routine to mark it done with an immediate satisfying visual response, so that the tablet feels responsive even before the server confirms.
57. As a child, I want to un-tap a Routine I ticked by mistake, so that the list is honest.
58. As a family member, I want a Routine ticked on one tablet to show as ticked on every other tablet and phone within a second or two, so that two devices never disagree.
59. As a child, I want every Routine to appear unchecked again after Household midnight regardless of yesterday, so that each day starts fresh.
60. As a parent, I want each day's completions kept as Routine Completions, so that streaks or history can be shown in a later version without a migration.
61. As a child, I want a Routine that isn't scheduled today (Saturday for school bag) to be absent, not greyed out, so that the list is short.
62. As a parent, I want a Routine assigned to a deleted Profile to be removed, so that orphaned rows don't appear.

### Shared Lists

63. As a family member, I want several named Shared Lists (Groceries, Costco, Camping), so that different shopping trips stay separate.
64. As a parent, I want to create, rename, reorder and delete Shared Lists, so that the set of lists matches our life.
65. As a family member at the tablet or on a phone, I want to add a text item to a list, so that "milk" is captured the moment we run out.
66. As a family member, I want to tap an item to cross it off with an immediate strike-through, so that shopping with the phone feels instant.
67. As a family member, I want crossed-off items to stay visible and struck until someone taps "clear completed", so that I can un-cross a mistake.
68. As a family member, I want "clear completed" to delete all crossed items on that list, so that the list stays short after a shop.
69. As a family member, I want to reorder items within a list, so that the list follows the store's aisles.
70. As a family member, I want list changes on one device to appear on all others within a second or two, so that two people shopping the same list stay in sync.
71. As a parent, I want to pin one Shared List to the home screen (default Groceries), so that the most-used list is always visible on the wall.
72. As a family member, I want to open the other lists from the tablet, so that non-pinned lists are still reachable.

### Home screen, views and display

73. As a family member, I want the home screen to show today and the next four days as columns, so that the working week is visible at once.
74. As a family member, I want the current day column highlighted and the current time indicated, so that "now" is obvious.
75. As a family member, I want a right-hand rail with today's Routines grouped by Profile and the pinned Shared List, so that the wall's three jobs are all visible without navigation.
76. As a family member, I want to open a week view and a single-day view, so that I can look further ahead or at a busy day in detail.
77. As a family member, I want to tap an event to see its details (full title, time, location, notes, which calendar), so that truncated titles aren't a dead end.
78. As a family member, I want all text legible from five feet with WCAG AAA contrast on a dark background, so that the wall works at night without glare.
79. As a family member, I want every tappable target to be at least 48×48 px, so that kids and wet hands don't mis-tap.
80. As a family member, I want the layout designed for a 16:10 landscape tablet, so that nothing is cut off or wastes space.
81. As a family member, I want the app to work as an installable PWA with an app icon, so that it launches full-screen from Fully Kiosk.
82. As a family member, I want the tablet to show the last known data if the network drops, and to reconnect automatically, so that a router reboot doesn't blank the wall.
83. As a family member, I want the day column to roll over at Household midnight without a manual refresh, so that a tablet left running for weeks stays correct.
84. As a family member, I want a dark theme always, so that the wall never glows white at night; dimming and screensaver belong to Fully Kiosk.

### Security and data ownership

85. As the Household Account, I want row-level security to guarantee that no request can read or write another household's rows, so that multi-tenancy is safe should it ever be turned on.
86. As a parent, I want Google refresh tokens stored encrypted in the platform vault and never returned to any client, so that a compromised tablet can't read our calendars elsewhere.
87. As a parent, I want a Device to be unable to write to Calendar Accounts, Mirrored Calendars, Profiles, Devices or Household settings, so that the wall's authority is limited to ticking, listing and Native Events.
88. As a parent, I want removing a Calendar Account to delete its vault secret, so that no token outlives its account.

### Operations

89. As the maintainer, I want the whole stack to run locally with the Supabase CLI and Docker, so that development and tests don't touch the hosted project.
90. As the maintainer, I want every schema change captured as a committed migration, so that local, test and hosted databases are provably identical.
91. As the maintainer, I want the sync to run every five minutes and a prune nightly via database cron, so that there is no separate worker to operate.
92. As the maintainer, I want sync errors recorded per Calendar Account with the last error message, so that failures are visible in settings rather than only in logs.
93. As the maintainer, I want the frontend deployed to Netlify from the main branch, so that shipping is a push.

## Implementation Decisions

- **Stack**: Vite + React + TypeScript strict + Tailwind + shadcn frontend on Netlify; Supabase for Postgres, row-level security, Auth, Realtime, Edge Functions, Vault and pg_cron. No Next.js, no custom API server, no queue, no WebSocket server (ADR 0001).
- **Principals**: two. A Household Account is a Supabase Auth user signed in with Google (identity scope only). A Device is a Supabase anonymous auth user linked to a Household by a `devices` row. One SQL helper, `current_household_id()`, resolves either principal from the JWT and backs every RLS policy.
- **Pairing**: an unpaired tablet signs in anonymously and inserts a `pairing_requests` row with a short random code and a few-minute expiry. The Household Account claims the code from a phone, which creates the `devices` row and marks the request claimed. Revocation deletes the `devices` row; the tablet detects the loss of authorisation and returns to the pairing screen.
- **Authority**: RLS write policies allow a Device to insert, update and delete only `native_events`, `native_event_profiles`, `routine_completions`, `list_items`, and update `devices.last_seen_at` for itself. Everything else is Household-Account-only. Both principals can read all rows in their Household.
- **Calendar consent**: an Edge Function starts a Google OAuth flow with `calendar.readonly` and offline access for a given Household; the callback stores the refresh token in Vault, creates or updates the `calendar_accounts` row with the Vault secret id, and lists that account's calendars. The consent link can be sent to another adult; it is bound to the Household, not to the person clicking it. Identity sign-in and calendar consent are never merged (ADR 0002).
- **Mirrored Calendars**: one row per Google calendar the parent selects, holding the Google calendar id, display name, colour override, `profile_id` (null = whole household), `selected`, and its own incremental `sync_token`. Attribution of Synced Events is derived through this row, never stored per event.
- **Sync**: a pg_cron job every five minutes invokes a sync Edge Function. For each active Calendar Account it decrypts the refresh token from Vault, obtains an access token, and for each selected Mirrored Calendar calls the events list with `singleEvents=true`, the stored sync token when present, and a window of −1 month / +6 months on full sync. Results upsert `synced_events` keyed by (mirrored calendar, Google event id); cancelled items delete. A 410 response clears the sync token and performs a full replace of that calendar's rows in one transaction. An invalid-grant response sets the Calendar Account to `needs_reauth` and records `last_error`. Success updates `last_synced_at`.
- **Timezone**: stored on `households`. All "today", day-boundary, days-of-week and rollover computations use it, on both server and client. Timestamps are stored as `timestamptz`; all-day events store their date in the Household Timezone.
- **Events**: `synced_events` and `native_events` are separate tables. A read view `calendar_occurrences` unions them with a `source` column and resolved Profile ids and colours for the frontend. Native Events have no recurrence in v1. Native Event attribution is a join table to Profiles; zero rows means whole household.
- **Routines**: `routines` carry `profile_id`, title, `days_of_week` bitmask, sort order and `archived_at`. "Checked today" is the existence of a `routine_completions` row for today's Household date; there is no reset job. Ticking inserts, un-ticking deletes.
- **Shared Lists**: `shared_lists` and `list_items` with `crossed_at`; "clear completed" deletes crossed items. `households.pinned_list_id` selects the home-screen list.
- **Realtime**: the frontend subscribes to Postgres changes on the Household's tables and refetches the affected query on any change. No surgical cache updates. Deletes are the one exception: Realtime applies no row-level policy to a delete, so it is delivered to every subscriber of the table, in any Household, including an unpaired anonymous session, carrying the primary key and timing only, never any other column; the frontend reads nothing from the payload. Accepted for v1; a second Household on the same hosted project is the trigger to move the change feed to Broadcast on private per-Household topics. Optimistic UI for ticking routines and crossing items, rolled back on error.
- **Home screen**: five day columns (today + 4) with an all-day band, current-time indicator and a right rail (today's Routines by Profile, pinned Shared List). Week and day views are separate routes. Administration routes are gated on a Household Account session and hidden from Devices.
- **Scheduled maintenance**: nightly pg_cron prune of `synced_events` older than one month; pairing requests expire by timestamp and are pruned in the same job.
- **Schema**: as listed in PLAN.md; every table carries `household_id` directly or via one join.

## Testing Decisions

- **Seam**: one primary seam, the Supabase project boundary as the frontend sees it: PostgREST tables and views, RPC functions, and Edge Functions, exercised through the Supabase JS client against the local Supabase stack. Tests act as the real principals (a Household Account JWT, a Device anonymous JWT, an unauthenticated client) and assert on what each can read and write. This single seam covers RLS, pairing, routines, lists, native events, the occurrences view and the sync function's effects.
- **Google is the only fake**: the sync Edge Function takes its HTTP fetch as an injectable dependency; tests supply canned Google responses (incremental delta, cancelled occurrence, 410, invalid grant) and assert on the resulting rows. No mocking of the database.
- **What makes a good test**: it drives the system the way a phone or tablet would and asserts on externally observable results (rows visible to a principal, a view's output, a Device losing access). Tests never reach into internal helpers, and never assert on implementation details such as which policy denied a write.
- **Frontend**: a small number of component tests for pure date logic (Household Timezone day boundaries, days-of-week scheduling, occurrence placement in columns). Full UI end-to-end tests are deferred to after the tablet is on the wall.
- **Prior art**: none; this is a greenfield repo. The first tests written establish the pattern: one test file per capability area, each using a shared fixture that resets the local database and creates a Household with two Profiles, one Device and one Calendar Account.
- **Runner**: Vitest for everything, including the Edge Function tests, which import the function's handler directly.

## Out of Scope

- Chores with rollover, meal planner, inbound email AI parsing, media screensaver, month and agenda views.
- Microsoft 365, Outlook and iCloud providers.
- Two-way sync or any write to Google (ADR 0002). Native Events never leave Nidus.
- Recurrence for Native Events.
- Profile PINs, per-person locking, or any per-Profile permission.
- Per-event Profile overrides for Synced Events.
- Streaks, rewards, points or completion history display (the data is kept; the UI is not built).
- Google push notification webhooks.
- Multi-household sign-up, billing, or any product surface beyond one household.
- Night dimming, screensaver, sleep schedule and auto-launch: Fully Kiosk Browser owns these.

## Further Notes

- Build order: Foundation (tooling, schema, RLS, sign-in, Profiles, pairing, empty home screen), then Calendar mirror, then Routines and lists, then On the wall (hosted Supabase, Netlify, Fully Kiosk, stale badge, prune). Each milestone ends runnable.
- Target hardware is an Android tablet in landscape running Fully Kiosk Browser. If an iPad is ever used, the pairing and wake behaviour need revisiting.
- The hosted Supabase project is created only at the final milestone; until then everything runs locally.
