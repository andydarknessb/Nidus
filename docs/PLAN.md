# Nidus — v1 plan

Settled in the design grilling on 2026-09-24. Vocabulary lives in [CONTEXT.md](../CONTEXT.md); the two load-bearing decisions are ADRs [0001](adr/0001-supabase-over-custom-backend.md) and [0002](adr/0002-read-only-calendar-mirror.md).

## Decisions

- **Audience**: one household (ours), on one or two Android tablets in landscape running Fully Kiosk Browser. `household_id` on every row keeps multi-tenancy possible without building it.
- **Principals**: one Household Account (Supabase Auth, Google sign-in, identity scope only). Profiles are people with no credentials. Devices are anonymous Supabase sessions linked to the Household by pairing (tablet shows a code, parent claims it from a signed-in phone). Devices read everything, tick Routines and list items, and manage Native Events; administration is phone-only.
- **Email sign-up**: off in production, so Google is the only way in for a Household Account. On in the local stack, because the test seam signs in with a password as the stand-in for Google.
- **Routes and anonymous sign-ins**: `/` is the Wall, for Devices and for the Household Account (a Device shows a Pairing Code until paired, then the home screen; a Household Account goes straight to the home screen and writes no heartbeat); `/settings` is administration, Household Account only, refusing any Device session. Anonymous sign-ins must be on (`enable_anonymous_sign_ins` in `supabase/config.toml` locally; Authentication settings on the hosted project, milestone 4), and `ensure_household` rejects anonymous sessions so a tablet can never own a Household. The Netlify SPA fallback for `/settings` lands with the deploy ticket.
- **Stack**: Vite + React + Tailwind + shadcn on Netlify. Supabase for Postgres, RLS, Auth, Realtime, Edge Functions, Vault, pg_cron. pnpm, TypeScript strict, Vitest, Supabase CLI with local Docker stack, migrations in-repo.
- **Calendar**: Google only. Per-Calendar-Account consent via Edge Function with `calendar.readonly` + offline access; refresh tokens in Vault. Poll every 5 minutes with syncToken; no webhooks. Recurring events stored as expanded occurrences in a window of −1 month / +6 months. Attribution lives on the Mirrored Calendar (Profile or household), never per event.
- **Sync edge cases**: cancelled occurrence → delete row; calendar unselected → delete its rows; 410 → full resync in one transaction; 404 on a calendar → that Mirrored Calendar and its events are deleted; token revoked → Calendar Account `needs_reauth`. Wall shows a "last synced" badge once an account is more than an hour behind.
- **Routines**: per Profile, days-of-week schedule. "Checked" = a Routine Completion exists for today's Household date, so there is no reset job.
- **Shared Lists**: many named lists, text-only items, crossed items stay struck until "clear completed" deletes them. One list is pinned to the home screen (Household setting, default Groceries).
- **Native Events**: no recurrence in v1; zero-or-more Profiles, zero = household.
- **Realtime**: subscribe to the household's tables; on any change, refetch the affected query. No surgical cache updates. Deletes are the one exception: Realtime applies no row-level policy to a delete, so it is delivered to every subscriber of the table, in any Household, including an unpaired anonymous session, carrying the primary key and timing only, never any other column; the frontend reads nothing from the payload. Accepted for v1; a second Household on the same hosted project is the trigger to move the change feed to Broadcast on private per-Household topics.
- **Home screen**: today + next 4 days as columns; right rail with today's Routines grouped by Profile and the pinned Shared List. Week and day views are secondary. Dark theme always; night dimming and screensaver belong to Fully Kiosk.
- **Timezone**: one Household Timezone; all display, date and reset logic uses it.
- **Dropped from v1**: Profile PIN, chores with rollover, meal planner, inbound email AI, media screensaver, month/agenda views, Microsoft and iCloud providers, two-way sync, Next.js, NestJS/Redis/BullMQ/Socket.io.

## Tables

```
households            id, name, timezone, pinned_list_id
household_accounts    auth_user_id → auth.users, household_id
profiles              id, household_id, name, color, avatar_url, sort_order
devices               id, household_id, auth_user_id (anon session), name, paired_at, last_seen_at
pairing_requests      code, device_auth_user_id, expires_at, claimed_at
calendar_accounts     id, household_id, google_email, vault_secret_id, status (active|needs_reauth), last_synced_at, last_error
mirrored_calendars    id, calendar_account_id, google_calendar_id, name, color, profile_id (null = household), selected, sync_token
synced_events         id, household_id, mirrored_calendar_id, google_event_id (unique per calendar), title, description, location, starts_at, ends_at, is_all_day
native_events         id, household_id, title, location, notes, starts_at, ends_at, is_all_day
native_event_profiles native_event_id, profile_id
routines              id, household_id, profile_id, title, days_of_week (bitmask), sort_order, archived_at
routine_completions   routine_id, completed_on, completed_at   unique(routine_id, completed_on)
shared_lists          id, household_id, name, sort_order
list_items            id, list_id, text, crossed_at, sort_order
```

Synced and Native Events are separate tables, unioned in a read view `calendar_occurrences` for the frontend. RLS uses one helper, `current_household_id()`, resolving either a Household Account or a Device.

## Milestones

1. **Foundation** — repo tooling, local Supabase, schema + RLS, Google sign-in creating a Household, Profiles CRUD, Device pairing, tablet renders an empty home screen.
2. **Calendar mirror** — consent flow, Mirrored Calendar selection, sync Edge Function + cron, five-day home view, week and day views.
3. **Routines and lists** — Routines per Profile with completions, Shared Lists, Realtime refetch across devices.
4. **On the wall** — hosted Supabase and Netlify, Fully Kiosk setup, stale-sync badge, nightly prune.

## v2: closing the gaps with Skylight

Settled on 2026-10-01 from the feature-by-feature comparison in [skylight-comparison.md](skylight-comparison.md). The spec is [0002](specs/0002-skylight-gaps.md).

### Decisions

- **Picked up from the v1 drop list**: the month view, and a meal plan cut down to free text per slot (no recipes, no AI).
- **Still dropped**: Profile PIN, chores with rollover, stars and rewards, inbound email AI, media screensaver, Microsoft and iCloud providers, two-way sync, recurring Native Events (a repeating event belongs in Google).
- **Shell**: a navigation rail on the left (Home, Day, Week, Month, Routines, Meals, Lists) with Add event at its foot, and a header with the Household's name, the clock and date, the weather and the Profile filter. The home screen keeps its decision: today + 4 days and the right rail. Padding and gaps tighten so the navigation rail does not cost the day columns their width. A calendar view opened from the navigation rail keeps the date the Wall is on, and opens on today whenever the page being left holds today.
- **Month view**: Sunday-to-Saturday weeks, each day one button into the Day view, a few occurrences and "+N more". Paging stays inside the mirror's window, and a day beyond the window says so rather than looking free. Read one week row at a time, under the API's 1000-row cap.
- **Profile filter**: toggle chips per Profile. A filtered Wall shows the pressed Profiles' occurrences and every whole-Household one. The filter is per screen, unsaved, and clears itself after two minutes: the Wall belongs to everyone.
- **Routines**: an optional time of day (morning, afternoon, evening) groups them on the Wall and on the phone; the phone edits a Routine in place. A full-screen chart shows a column per Profile with progress, and a tap that finishes a Profile's day plays a short celebration on the chart or the home screen (none under reduced motion). No points, no streaks.
- **Meals**: free text, one per slot (breakfast, lunch, dinner, snack) per Household date. A Device may write them, the same trust as a list item: this widens the Principals decision above by exactly that. Kept forever; the rows are tiny.
- **Weather**: the Household stores a place (name, coordinates the database rounds to two decimals) and a temperature unit. The screen itself asks Open-Meteo for the forecast: no key, no server hop, nothing stored. That is the one read that leaves the Household besides Google's: each screen sends the rounded coordinates, the timezone and its own IP address to Open-Meteo every 30 minutes, and the phone sends the typed place name when searching. Current conditions older than two hours are not shown. If Nidus ever serves a second Household, move the fetch behind an Edge Function with a cache.
- **Deploy order**: every v2 migration is additive and reaches the hosted project before the frontend that reads it is merged, one ticket at a time: rebase on `master`, push the migration, merge straight after. `supabase db push --include-all` when a file sorts before one already pushed. A pull request that carries several migrations pushes them all, once, immediately before it merges.

### Tables

```
households            + weather_place, latitude, longitude, temperature_unit (fahrenheit|celsius)
routines              + time_of_day (morning|afternoon|evening, null = any time)
meals                 id, household_id, meal_date, slot (breakfast|lunch|dinner|snack), title   unique(household_id, meal_date, slot)
```

## v3: the look

Settled on 2026-10-02 after a UI and UX audit of the v2 build and the owner's review of the drawings that followed it. The spec is [0003](specs/0003-the-look.md); the tokens and parts are in [look.md](look.md).

### Decisions

- **Two modes**: light by day, dark at night. This replaces "dark theme always" above. Auto follows sunrise and sunset from the forecast the Wall already fetches (7:00 and 19:00 in the Household Timezone when there is none). A switch on the Wall overrides it on that screen until the next sunrise or sunset, and the Household's Appearance (Auto, Light, Dark) is set on the phone. AAA contrast holds in both. Night dimming and the screensaver still belong to Fully Kiosk.
- **One set of tokens**: the chrome is neutral and colour belongs to people. A Profile still stores one colour; the look uses four steps of its family, and what each step is for changes with the mode in CSS, not in components. The whole Household and Meals share a warm neutral.
- **Never colour alone**: a person is a disc with their initial. Photos stay off the Wall.
- **Home and Week are a schedule**: events stack under their day in time order instead of sitting on an hour grid, so nothing collides and no title breaks inside a word. The gaps between events are no longer drawn there; the Day view keeps the hour grid, at 48 px an hour.
- **A calendar has no colour of its own**: an event takes the colour of the Profile its Mirrored Calendar is set to, or the whole Household's. The phone's colour picker for a calendar goes; the column stays.
- **People strip**: a row of people under the header replaces the header's Profile chips. It shows each person's Routines for today and is the Profile filter, whose two minutes now restart on any touch inside the calendar.
- **Routines**: a picture each, from a fixed set, picked on the phone. The chart opens on the part of the day it is now and follows it: morning until 12:00 (from midnight, so a new day is never "left from earlier"), afternoon from 12:00, evening from 17:00, in the Household Timezone. What was missed earlier stays in view. The chart keeps a column for every Profile that has a Routine on any day. On Home, Up next (a tile each for up to three people with something left) replaces the Routines rail. Still no points and no streaks.
- **Lists**: a view inside the shell with every Shared List on it, the Pinned List first. The full-screen overlay goes.
- **Meals on Home**: the header's next-meal button replaces the Today's meals card.
- **Native Events stay inside a day**: the redrawn sheet's times stop before midnight. An event that runs past it belongs in Google.
- **Type**: Young Serif for the clock, dates, names and titles, Lexend for everything else, both shipped with the app.
- **Deploy order**: as v2. Two additive migrations, pushed together immediately before the pull request that reads them is merged.

### Tables

```
households            + appearance (auto|light|dark, default auto)
routines              + picture (a key from the app's fixed set, null = none)
```

## v4: the Wall on a phone

Settled on 2026-10-06 when the owner approved the phone drawings on the design canvas. The spec is [0004](specs/0004-the-wall-on-a-phone.md); the sizes are in [look.md](look.md), "The phone". It replaces the fleet's #50.

### Decisions

- **The Wall is not only for a tablet**: "one or two Android tablets in landscape" above stays the Devices' setting, and the Household Account may open the Wall on a phone. Below 768 px of viewport width it is laid out for a phone; at 768 px and wider nothing changes (until v9's portrait). The width alone decides, never the user agent or a per-Device setting. Settled 2026-10-07 (#176): a phone on its side, wider than 768 px, is a phone too: below 544 px of height, the Wall's least height, which no tablet of the Wall's kind is under.
- **Five tabs**: Home, Calendar (Day, Week and Month behind one control), Routines, Meals, Lists, at the foot. Add event is a round button above them. Settings is a gear in the header, for the owner only.
- **No clock** in the phone's header: the date, the weather and the gear.
- **The phone's mode is the phone's**: it follows `prefers-color-scheme`. The Household's Appearance and the switch are for the Wall's tablets.
- **One thing at a time**: Home is one scrolling column (today, Up next, the Pinned List); Week and Meals show one day picked from seven chips; Month keeps the grid with a dot per person and lists the picked day; Routines shows one person; Lists one list.
- **The month and agenda views** dropped from v1 are both now in: Month since v2, and the phone's Home and one-day Week are the agenda.
- **Sheets rise from the foot** on a phone.
- **No new data**: no migration.

## v5: iPhone calendars

Settled on 2026-10-06 when the owner chose, of four ways to bring the family's iPhone calendars to the Wall, the iCloud public link. The spec is [0005](specs/0005-iphone-calendars.md); the choice is [ADR 0003](adr/0003-icloud-by-public-link.md). It takes iCloud off the "still dropped" lists above; Microsoft and two-way sync stay dropped.

### Decisions

- **iCloud by its public link**: the owner makes a calendar a Public Calendar on the iPhone and pastes its link into Settings. The link is a secret in Vault; only links on Apple's iCloud hosts are accepted or followed.
- **Same mirror**: an iCloud calendar is a Calendar Account of provider `icloud` with one Mirrored Calendar, attributed and drawn exactly as a Google calendar. Read-only; polled every five minutes; a whole read each time, skipped when unchanged.
- **Repeats expanded by Nidus** for this source, with `ical.js`, inside the same rolling window.
- **Deploy order**: push the migration, then deploy `calendar-connect` and `calendar-sync`, then merge. The new sync selects `provider`, so deploying it before the migration would stop every account's sync, Google's included.
- **A full read every 24 hours**, as for Google: a feed that keeps answering "unchanged" is still re-read once a day so its repeats roll forward with the window.

### Tables

```
calendar_accounts     + provider (google|icloud, default google), google_email nullable (required for google), + feed_key (unique per Household, icloud only), + last_attempted_at (icloud read order)
```

## v6: inviting another grown-up

Settled on 2026-10-06 when the owner asked for an invite feature so that another adult can add events from their own phone. The spec is [0006](specs/0006-household-invites.md).

### Decisions

- **More than one Household Account**: "one Household Account" under Principals above becomes one or more, all equal. No owner, no roles. Any of them may remove any other, never itself, so a Household always keeps one.
- **Invited by a link**: a Household Account makes a link in Settings and sends it through the phone's share sheet. It works once, for 7 days; one waits at a time, and a new one replaces it. Nidus sends no email.
- **One Household per Google account**: joining is refused for a Household Account of another Household. No moving or merging, with one exception (#126): a Household that holds nothing of anyone's (no other account, tablet, person, calendar, event, routine, meal, waiting invite, second list or list item) is given up when its account joins another.
- **The token is a secret**: only its SHA-256 is stored; `/join/*` is served with `Referrer-Policy: no-referrer`.
- **The invite route**: `/join/<token>` is the invite route, served like /settings (phone first, its own mode), with `Referrer-Policy: no-referrer`.
- **The Wall does not change**: Devices, Pairing Codes and the tablet screens are untouched.

### Tables

```
household_invites     household_id (pk), token_hash (unique), created_at, expires_at
household_accounts    grants narrowed to select; removal by remove_household_account (locks the Household, cancels its invite)
```

## v7: notifications on the phone

Settled on 2026-10-06 when the owner chose all four kinds of notification, each phone opting in. The spec is [0007](specs/0007-push-notifications.md). It replaces v2's "Reminders per event: Skip, a wall has nobody to notify": a phone has somebody.

### Decisions

- **Web Push, per phone, opt-in**: a Push Subscription is one browser signed in as a Household Account. Android from the browser; iPhone from the Home Screen app, iOS 16.4 or later. No app store app, no email.
- **Four kinds, each a switch per phone**: event reminders (5 to 60 minutes ahead, 15 by default, timed events only), a morning summary at 7:00, Routines not done at 19:00, additions to the Pinned List by someone else. Fixed times in the Household Timezone; late ones are skipped, not sent.
- **One sender**: Edge Function `push-notify`, run every minute by pg_cron, sends with `jsr:@negrel/webpush`. Every notification's key is claimed in `push_deliveries` before it is sent: at most once, never retried.
- **The push service is faked like the other outside HTTP** in tests, injected as `sendPush` beside Google's HTTP API and the iCloud feed.
- **A service worker at last**: `public/sw.js`, push and click only, no caching. Registered only when a phone turns notifications on.

### Tables

```
push_subscriptions    id, auth_user_id (-> household_accounts, cascade), endpoint (unique), p256dh, auth, event_reminders, reminder_minutes, morning_summary, routines_nudge, list_additions, created_at
push_deliveries       subscription_id, key (pk together), sent_at
list_items            + added_by (default auth.uid())
```


## v8: deeper modules

Settled on 2026-10-07 from an architecture review the owner approved in full. The spec is [0008](specs/0008-deeper-modules.md); tracker #144, tickets #145 to #156.

### Decisions

- **One rule for skipped and repeated times**: RFC 5545 everywhere (skipped: forward by the gap; repeated: the first). The iPhone sync's floating-time fix (#145) ships to master first.
- **No visible change** beyond: one refresh timing (30 s, 5 s after a failure), a month that loads as a whole, a calendar the sync did not reach left untouched, a failed write that takes back only itself.
- **Replace, don't layer**: tests of helpers that become internal move to the new interface case for case.
- **Plain TypeScript cores, thin hooks**: stateful modules are tested below React; no DOM test library.
- **Facts, not sentences** between the sync and Settings: `truncated` on the Calendar Account; `last_error` is for logs only.

### Tables

```
calendar_accounts    + truncated boolean not null default false
```

## v9: the Wall in portrait

Settled on 2026-10-07 when the owner asked for the Wall to fit the Lenovo Tab P12 (12.7 inches, 2944 by 1840, 16:10) hung either way. The spec is [0009](specs/0009-the-wall-in-portrait.md); the sizes are in [look.md](look.md), "Portrait". It qualifies "one or two Android tablets in landscape" above: landscape or portrait, as the household hangs it.

### Decisions

- **Portrait is the tablet's second form**: at 768 px and wider, a viewport taller than it is wide, by the viewport alone. Below 768 px it is a phone whatever its height. Landscape changes nothing, at any size.
- **The chrome is the Wall's**: the rail at the left, the header, the people strip, the switch, the Household's Appearance. No tabs, no gear.
- **Five screens use the height**: Home puts the days across the top and Up next beside the Pinned List under them; Week is seven rows; Meals turns, days down and slots across; the Routines chart and the Lists screen wrap. Month, Day and the sheets keep their form and give way by their own rules.
- **The orientation is the kiosk's**: Fully Kiosk's Screen Orientation setting; the manifest asks for none and the app never locks one.
- **No new data**: no migration.

## v10: the Wall on a 24-inch screen

Settled on 2026-10-08 when the owner asked for the Wall to fit an Elo 2402L touch monitor (24 inches, 1920 by 1080, 16:9) on a Windows PC, hung either way. The spec is [0010](specs/0010-the-wall-on-a-24-inch-screen.md); the sizes are in [look.md](look.md), "A 24-inch screen"; the host is [windows-kiosk.md](windows-kiosk.md). It qualifies "one or two Android tablets" above: a Device may be a PC's browser.

### Decisions

- **The rules hold**: the viewport alone decides, and by it the Elo is a Wall both ways, 1920 by 1080 in landscape (five days, three tiles) and 1080 by 1920 in portrait (four days, and the tiles the height holds). No rule reads the screen.
- **The host decides the orientation and the size**: Windows' display orientation turns the screen, and Chrome runs in kiosk mode with a profile folder that keeps its storage, since the Device's pairing lives there. The app locks no orientation.
- **Larger text is the browser's font size**, held at 130 percent; zoom shrinks the viewport and is held to 125 percent. At 150 percent in portrait the Wall is a phone by its rule.
- **Nothing scales up for the panel**: the look's tokens, parts and sizes are unchanged at 92 pixels per inch.
- **The Device is a tablet or a PC's browser**: pairing, the Pairing Code, the heartbeat and what a Device may write do not change.
- **Portrait's Routines and Lists are a grid**: columns and cards at least 17 rem, as many to a row as fit, each its row-mates' width; the P12 gets it too.
- **Home in portrait fills the height**: Up next shows the tiles a third of the height holds, never fewer than three; the lower row follows; the P12 gets it too.
- **No new data**: no migration.

## v10: deeper screens

Settled on 2026-10-09 from an architecture review the owner approved in full, two rounds of rulings. The spec is [0011](specs/0011-deeper-screens.md); tracker #198, tickets #199 to #205. It continues v8 one layer up: the screens.

### Decisions

- **One visible change**: a list whose last read or write failed shows no count on the Wall, as on the phone. It ships to master first.
- **One module each** for the Shared List card, the Meal Plan week, an event's time words (facts then words, shared with push-notify), the Wall's routes, the read state (with the card write behind `change`) and the lib client convention (the client as the first argument, everywhere).
- **Meal Plan** enters the glossary.
- **v8's rulings hold**: replace don't layer, plain cores with thin hooks, facts not sentences, no DOM test library.

### Tables

No migration.

## v11: deeper modules, round three

Settled on 2026-10-12 from an architecture review of the finished v10 branch, three rounds of rulings, every recommendation taken. The spec is [0012](specs/0012-deeper-modules-round-three.md); tracker #219, tickets #220 to #226. It continues v8 and v10.

### Decisions

- **One visible change**: a phone's month cell is named for a screen reader in the phone's order (the words, then "today"), as the chips and the Wall's cells are. It ships on `owner/v10` ahead of the release.
- **One module each** for the run budget of an iPhone feed (every cap and check), the Routine Chart (the Wall's chart and the phone's card from one core), the event sheet host (one open state, one after-save rule, one frame), the card change (the problem words inside `change`, one name for "landed"), the Month Cells (one week of cells behind both grids) and the client's reads (Profiles onto the synced read; the weather's fetch injected).
- **Routine Chart** enters the glossary.
- **Rejected, with an ADR**: a Household context ([ADR 0004](adr/0004-the-household-facts-are-props-not-a-context.md)). Declined without one: a room-measuring hook.
- **v8's rulings hold**: replace don't layer, plain cores with thin hooks, facts not sentences, no DOM test library.

### Tables

No migration.

## v12: a time to tap, and events that repeat

Settled on 2026-10-13, one round of rulings, every recommendation taken. The spec is [0013](specs/0013-time-and-repeats.md); tracker #235. It reverses "a repeating event belongs in Google" for the household's own things ([ADR 0005](adr/0005-native-events-repeat-expanded-by-the-database.md)).

### Decisions

- **A time sheet of our own** replaces the quarter-hour steppers: three drums (hour, minute in fives, AM or PM) and a typed field that takes "4", "4:30", "430", "16:30", "4pm". Moving the start keeps the event's length. Same on the tablet, the Elo and a phone; not `<input type="time">`.
- **Repeats** on Native Events: every N days, weeks on chosen weekdays, months on the same date, years; until a date or forever; N is 1 to 99. "This one" or "every one" at Save and Delete; "this one" skips the day. No "this and after", no count, no "second Tuesday", no pill mark.
- **The database expands a Repeat** into Occurrences in the `calendar_occurrences` view as it is read, two years ahead and back to the first day, minus the skipped days. No job, no rows for days to come; the push reminders read it unchanged.
- **Repeat** and **Occurrence** enter the glossary.

### Tables

- `native_events` gains `repeat_every`, `repeat_interval`, `repeat_days`, `repeat_until`.
- `native_event_skips`: the days a Repeat leaves out.

## v13: deeper modules, round four

Settled on 2026-10-24 from an architecture review of master, two rounds of rulings, every recommendation taken. The spec is [0014](specs/0014-deeper-modules-round-four.md). It continues v8, v10 and v11.

### Decisions

- **One change.** Every screen writes through one interface, `change(place, work, then)`: the guard, the write, the read-back, the places and the words behind it. A page keeps no page-wide string for a write; an action with no row of its own names the page's line as its place (`reorder`). The Meal sheet's own busy and problem flags go. [ADR 0006](adr/0006-one-change.md).
- **One form row.** A form that takes a row's place (add or edit a list, a person, a tablet, an iPhone calendar, a Routine) has one lifecycle: the asked-for-name count and its words, the busy guard, the problem's place and the focus return. A row that stays open does not close.
- **One card read.** `Card` takes the read and its noun and draws the lost-connection line; a card whose sentence is narrower (notifications) passes its words.
- **One navigator.** The route module returns a navigator of named intents (`open`, `home`, `routines`, `meals`, `lists`), one prop for both rails and every phone screen; the six-slot tuple and the four callbacks go.
- **One shelf.** The Routines chart and the Lists screen share the heading row, the sideways row, the portrait grid and the More foot.
- **One name for the shared folder.** `@shared` aliases the Edge Functions' pure modules for the client and the tests; the functions keep their relative imports and nothing moves.
- **No visible change on the normal path.** Unlike v11, there is no fix; a write that did not go through is said at its place (beside the field or row, or the page's line for an action with no row). The suite is the safety net.
- **The six names live in the spec**, not in `CONTEXT.md`, which stays a glossary of household things.
- **v8's rulings hold**: replace don't layer, plain cores with thin hooks, facts not sentences, no DOM test library, props not a context ([ADR 0004](adr/0004-the-household-facts-are-props-not-a-context.md)).

### Tables

No migration.

## v14: deeper modules, round five

Settled on 2026-10-27 from an architecture review of master after v13, two rounds of rulings, every recommendation taken. The spec is [0015](specs/0015-deeper-modules-round-five.md) (tracker #262). It continues v8, v10, v11 and v13.

### Decisions

- **One event draft.** The Native Event form's rules (opening times, the day, the Repeat's shape, Everyone, untouched, the time sheet's Done, whether Save asks "this one, or every one?") live in a plain core of pure transitions; submit and answer give a plan (`add`, `save`, `save-one`, `save-every`, `skip`, `delete`), and one runner with the Native Event module's database half writes it and gives the sentence. A thin hook keeps the current draft; the sheet keeps markup, focus and wiring. This reopens v8's out-of-scope ruling, made before Repeats.
- **One hold.** Up next and the Pinned List card keep a tapped row for four seconds through one rule, one clock and one focus hand-off to the heading link; `now` leaves the Routine Chart's state.
- **Dropped**: one rule for the Routines left on a Household Date shared with the push (one line, and the Profile orders differ), and one description per Calendar Account provider on the client (the branches choose contents, not words).
- **No visible change.** What removing a Google account and an iPhone calendar say is its own issue (#265).
- **The new names live in the spec**, not in `CONTEXT.md`.
- **v8's rulings hold**: replace don't layer, plain cores with thin hooks, no DOM test library, props not a context ([ADR 0004](adr/0004-the-household-facts-are-props-not-a-context.md)), one change at a place ([ADR 0006](adr/0006-one-change.md)).

### Tables

No migration.

## v15: four fixes

Settled on 2026-10-27 from an audit of master and the grilling that followed, every recommendation taken. The spec is [0016](specs/0016-four-fixes.md) (tracker #270).

### Decisions

- **A time zone change keeps Native Events where the family put them.** Every Native Event, one-off and Repeat, all-day and timed, past and future, keeps the Household Date and clock time it was entered with: a trigger on the Household rewrites them in the same transaction, for every writer. Skipped days and a Repeat's end are dates and stay.
- **Synced Events follow their source.** The trigger never writes them (ADR 0002); it clears each Mirrored Calendar's last full read, so the next run reads in full in the new zone.
- **A Google calendar Google cannot find (404) leaves Nidus**, with its Synced Events, silently; the account counts as synced. 403 and 429 stay passing failures. Reconnecting lists it again if it comes back.
- **Day and week Repeats expand from at most two years back**, as they stop two years ahead. Month and year Repeats and the event form are unchanged.
- **The list notification names every recent item** someone else added and nobody crossed off, sent only when something new was claimed; its tag still replaces the last one.
- **Dropped**: leaving unchanged Synced Events unwritten on a full read.
- **Four tickets, no spec blockers**, each its own pull request into `master`.

### Tables

Two migrations: the time zone trigger on `households`, and the expansion function of Native Event Repeats replaced with the two-year floor. No table changes.

## v16: two fixes

Settled on 2026-10-28 from a technical audit of the screens and the grilling that followed, every recommendation taken. The spec is [0017](specs/0017-two-fixes.md) (tracker #280).

### Decisions

- **A sheet's More foot is the Wall's at any width.** The phone layout's rule hides it, no longer a width of 960 px, so a portrait P12 (about 920 px wide) and the Elo upright at 125 percent (864) show it. 960 px stays only the Add event sheet's one column or two.
- **The list chip's count is 14 px**, the type floor, on a 20 px line; the chip stays 56 tall.
- **Dropped**: splitting the Settings bundle, about 4 percent of the source.
- **Two tickets, no blockers**, each its own pull request into `master`.

### Tables

None.

## v17: whose events a phone gets

Settled on 2026-10-28 from the owner's report that a phone gets reminders for events the Wall draws under another person's disc, diagnosed and then decided with every recommendation taken. The spec is [0018](specs/0018-whose-events-a-phone-gets.md) (tracker #286). It replaces v7's "there is no per-person filter".

### Decisions

- **Per phone**: each Push Subscription chooses Everyone (the default, as before) or one or more Profiles. No link from a Household Account to a Profile.
- **An event's people are the Wall's**: `calendar_occurrences.profile_ids`, empty meaning everyone. A phone gets an event when it chose Everyone, the event is for everyone, or the two share a person.
- **The 7 AM summary follows the same rule**; meals, the Routines nudge and list additions do not change.
- **One ticket** (#287), one pull request into `master`. Deploy: the migration, then `push-notify`, then merge.

### Tables

```
push_subscriptions    + profile_ids (uuid[], default '{}', at most 100; empty is Everyone)
```
