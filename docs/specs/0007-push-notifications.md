# Nidus v7: notifications on the phone

Tracker: GitHub issue #133; its sub-issues are the tickets. Vocabulary: [CONTEXT.md](../../CONTEXT.md) (Household Account, Push Subscription). Decisions: [PLAN.md](../PLAN.md) (v7 section). The look: [look.md](../look.md); the new Settings card is built from `@/components/phone` like every other.

## Problem Statement

Nidus only speaks when someone looks at the Wall. The grown-ups carry phones that already sign in as Household Accounts (v4, v6), but nothing reaches them when they are not looking: an appointment in fifteen minutes, what today holds, a child's unticked Routines at bedtime, milk added to Groceries while they are at the shop. v2 skipped reminders because "a wall has nobody to notify"; a phone has somebody.

## Solution

Each phone that signs in to Settings can turn on notifications. Nidus then sends that phone, through the standard Web Push service of its browser, up to four kinds of notification, each switched on or off for that phone:

1. **Event reminders**: before each timed event on the Household's calendar, 5, 10, 15, 30 or 60 minutes ahead (15 by default).
2. **Morning summary**: at 7:00 in the Household Timezone, today's events and meals.
3. **Routines not done**: at 19:00, who still has Routines left today.
4. **Added to the list**: when someone else adds to the Pinned List.

Android phones can turn this on from the browser. iPhones need iOS 16.4 or later and Nidus added to the Home Screen; the card says how. Tapping a notification opens the Wall at the right screen.

## User Stories

1. As a parent, I want to turn on notifications on my phone from Settings, so that Nidus can reach me when I am not looking at the Wall.
2. As a parent on an iPhone, I want to be told plainly that I must add Nidus to my Home Screen first, and how, so that I am not left wondering why nothing happens.
3. As a parent, I want a reminder before each event, with the lead time I choose, so that I leave on time.
4. As a parent, I want a short summary each morning of today's events and meals, so that I know the day before I reach the kitchen.
5. As a parent, I want a nudge in the evening when a child's Routines are not done, so that bedtime does not slip.
6. As a parent at the shop, I want to know when someone adds to the shopping list, so that I buy it while I am there.
7. As a parent, I want not to be told about what I added myself, so that the notifications stay worth reading.
8. As a parent, I want to choose which of the four kinds this phone gets, and to turn them all off, so that each phone gets only what its owner wants.
9. As a parent, I want to send myself a test notification, so that I know it works.
10. As a parent, I want tapping a notification to open the right screen of the Wall, so that I can see the detail.
11. As a parent who removed someone from the household, I want their phones to stop getting anything at once.
12. As a family member at the Wall's tablet, I want nothing to change.

## Implementation Decisions

### Rulings

- **Per phone, opt-in**: a Push Subscription belongs to one browser on one phone and to the Household Account signed in there. Nothing is sent until that phone turns notifications on. All four kinds start on once it does; the lead time starts at 15 minutes.
- **Household Accounts only**: a Device (the Wall's tablet) never subscribes. Notifications cover the whole Household's calendar, Routines and Pinned List; there is no per-person filter.
- **Fixed times**: the morning summary at 7:00 and the Routines nudge at 19:00, in the Household Timezone. A summary not sent by 10:00, or a nudge not sent by 22:00, is skipped for that day rather than sent late.
- **Timed events only** get reminders; all-day events are in the morning summary. An event added after its reminder time but before it starts is reminded at once.
- **Not your own**: a list addition is not sent to the Household Account that added it. Additions by a Device (the Wall) go to everyone.
- **At most once**: every notification has a key, claimed in the database before it is sent; a claimed key is never sent again, even if the send fails. No retries.
- **Removal ends it**: a Push Subscription references `household_accounts`, so removing a Household Account deletes its phones' subscriptions with it.
- **A dead subscription is deleted** when the push service answers 404 or 410.
- **Words on the lock screen**: notifications carry event titles, meal names and item text, which show on the lock screen. That is the point of them; the card says so in one line.
- **No email, no SMS, no app store app.** Web Push only.

### Data: migration `20261021000001_push_notifications.sql`

- `push_subscriptions`: `id` uuid primary key; `auth_user_id` uuid not null references `household_accounts (auth_user_id)` on delete cascade; `endpoint` text not null unique (`https://`, at most 2048 characters); `p256dh` text not null; `auth` text not null; `event_reminders` boolean not null default true; `reminder_minutes` smallint not null default 15 check in (5, 10, 15, 30, 60); `morning_summary`, `routines_nudge`, `list_additions` boolean not null default true; `created_at` timestamptz default now(). RLS on. `authenticated` may select every column but `p256dh` and `auth`, update only the five preference columns, and delete, each under a policy `is_household_account() and auth_user_id = auth.uid()`. No insert grant. `anon` gets nothing.
- `save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)` returns uuid: security definer, `search_path = ''`, Household Account only (42501 otherwise), validates the endpoint (`https://`, length) and keys (non-empty, at most 200 characters). Upserts on `endpoint`: the same browser subscribing again keeps its row and preferences, and a browser now signed in as another Household Account moves to that account.
- `push_deliveries`: `subscription_id` uuid references `push_subscriptions` on delete cascade, `key` text, `sent_at` timestamptz default now(), primary key `(subscription_id, key)`. RLS on, no client grants: the Edge Function (service role) claims a key with `insert ... on conflict do nothing` and sends only when the insert made a row. `prune_stale_rows()` also deletes deliveries older than 2 days.
- `list_items.added_by` uuid, default `auth.uid()`, no foreign key. The existing column-level insert grant (`list_id, text, sort_order`) already stops a client from writing it, so it is always the inserter. Existing rows stay null.
- Scheduling, as `invoke_calendar_sync` does: `invoke_push_notify()` reads Vault secrets `push_notify_url` and `push_notify_secret`, returns null when either is missing, and posts with header `x-push-secret`. `cron.schedule('push-notify', '* * * * *', ...)`.

### The sender: Edge Function `push-notify`

- `index.ts` / `handler.ts` split like `calendar-sync`. `handler.ts` imports nothing Deno-only. Its deps: `admin` (service role client), `sendPush(subscription, payload) => Promise<'sent' | 'gone' | 'failed'>`, `now()`, `env` (`pushSecret`, `applicationServerKey`), and an optional `householdId` that scopes a run in tests. `index.ts` builds `sendPush` with `jsr:@negrel/webpush` (`ApplicationServer`, `importVapidKeys`; `npm:web-push` does not run on the Edge Runtime), TTL 3600 and Urgency `normal` for reminders and `low` for the others, and maps a `PushMessageError` with `isGone` to `'gone'`.
- Secrets: `PUSH_NOTIFY_SECRET` (at least 32 characters, the same value in Vault), `VAPID_KEYS` (the JWK pair from `exportVapidKeys`, as JSON), `VAPID_SUBJECT` (`mailto:` the owner). `config.toml` gets `[functions.push-notify]` with `verify_jwt = false`.
- Routes:
  - `GET /push-notify/key`: the base64url application server key, public, no auth. The browser fetches it when subscribing, so no Netlify setting is needed.
  - `POST /push-notify` with `x-push-secret` (constant-time compare): the minute's run. Answers 200 with counts per kind.
  - `POST /push-notify/test` with a Household Account's `Authorization: Bearer` (resolved with `admin.auth.getUser`, then `household_accounts`, as `calendar-connect` does) and body `{ endpoint }`: sends "Notifications are on" to that subscription only if it is the caller's. Not claimed in `push_deliveries`.
- The run, for every subscription whose account is still a Household Account (a join to `household_accounts` gives the Household and its timezone):
  - **Event reminders** (`event_reminders`): rows of `calendar_occurrences` for the Household (it already shows only selected Mirrored Calendars and both kinds of event) with `is_all_day = false` and `now < starts_at <= now + reminder_minutes`. Key `event:<source>:<id>:<starts_at epoch>`. Title: the event title. Body: "At 8:30 AM, in 15 minutes" (the real minutes left, rounded, "now" under one minute), then the location if there is one, on a second line. Opens `/day?date=<its Household date>`.
  - **Morning summary** (`morning_summary`): when the Household's local time is from 07:00 to before 10:00. Key `morning:<date>`. Title "Today". Body: up to four events in order ("All day: Holiday", "8:30 AM Swim"), "and 3 more" past four, then today's meals in slot order ("Dinner: Tacos"). "Nothing on the calendar today." when there are no events. Opens `/`.
  - **Routines not done** (`routines_nudge`): from 19:00 to before 22:00. Key `routines:<date>`. For each Profile in order, the Routines scheduled today (`archived_at` null, today's weekday bit set in `days_of_week`) without a completion for today's date. Nothing is sent when nobody has any left. Title "Routines not done". Body "Sam: 2 left. Mia: 1 left." Opens `/routines`.
  - **Added to the list** (`list_additions`): items of the Household's Pinned List, not crossed off, created more than 1 minute and at most 15 minutes ago (the minute lets a burst of typing arrive together), whose `added_by` is not this subscription's account. One key per item, `item:<id>`; the items claimed in one run go in one notification. Title "Added to {list name}". Body the items' text joined with ", ". Opens `/lists`.
- Payload: JSON `{ title, body, url, tag }`, title at most 80 and body at most 300 characters (cut with "…"), well under the 2 KB iPhone limit. `tag` is the key's kind and date (or the event key), so a newer notification of the same kind replaces an older one.
- Times in words use the Household Timezone (`_shared/zoned-time.ts`, `Intl.DateTimeFormat` with `timeZone`), never the machine's zone. No em-dashes.
- A send answering `'gone'` deletes the subscription. A send answering `'failed'` is counted and left; its key stays claimed.

### The phone: service worker, the client module, the Settings card

- `public/sw.js`, plain JavaScript, no build step, no `fetch` handler (it caches nothing and never touches page loads). `push`: parse the JSON and always call `showNotification(title, { body, tag, data: { url }, icon: '/icons/icon-192.png' })`, even for a malformed payload ("Nidus"), because iPhones revoke a subscription that receives a push without a notification. `notificationclick`: close it, focus an open Nidus window and navigate it to `url`, or open one.
- `index.html` gains `apple-touch-icon` (`/icons/icon-192.png`), `apple-mobile-web-app-capable` and `apple-mobile-web-app-title` ("Nidus"). The manifest already says `display: standalone`.
- `src/lib/push.ts`, the only place the UI reaches push. Its interface is fixed so the card and the data can be built at once:

```ts
export type PushSupport = 'supported' | 'needs-home-screen' | 'unsupported';
export type PushPreferences = {
  eventReminders: boolean; reminderMinutes: 5 | 10 | 15 | 30 | 60;
  morningSummary: boolean; routinesNudge: boolean; listAdditions: boolean;
};
export type PushState = { kind: 'off' } | { kind: 'denied' } | { kind: 'on'; id: string; preferences: PushPreferences };

export function pushSupport(nav?: Navigator, win?: Window): PushSupport; // pure over what it is given; 'needs-home-screen' is an iPhone or iPad Safari tab
export async function readPushState(): Promise<PushState>;               // this browser's subscription and its row
export async function turnOnNotifications(): Promise<PushState>;         // call from a tap: register /sw.js, ask permission, fetch the key, subscribe, save_push_subscription
export async function turnOffNotifications(): Promise<void>;             // unsubscribe and delete the row
export async function savePushPreferences(id: string, preferences: PushPreferences): Promise<void>;
export async function sendTestNotification(): Promise<void>;             // POST /push-notify/test with this browser's endpoint
```

- The service worker is registered only by `turnOnNotifications`. The Wall's tablets never register it.
- `NotificationsSection` (`src/NotificationsSection.tsx`) in `SettingsPage` after "Who can sign in", built like the other sections (Card, Field, Problem, one write at a time with `aria-disabled`, 48 px targets). Card title "Notifications on this phone". States:
  - `unsupported`: "This browser cannot show notifications from Nidus."
  - `needs-home-screen`: "On iPhone, notifications need Nidus on your Home Screen. In Safari, tap Share, then Add to Home Screen, then open Nidus from the new icon and come back here." (iOS 16.4 or later.)
  - `off`: "Get reminders and updates on this phone, even when Nidus is closed." and a primary "Turn on notifications".
  - `denied`: "Notifications are blocked for Nidus on this phone. Allow them in the phone's settings, then come back here."
  - `on`: four switches, each a labelled checkbox row: "Event reminders" with a select "How long before" (5, 10, 15, 30, 60 minutes), "Morning summary at 7 AM", "Routines not done at 7 PM", "Added to the shopping list" (the Pinned List's name if it has one). Each change saves at once. Then "Send a test", then a quiet "Turn off notifications". The line "Notifications can show event names on your lock screen."
  - Status line as the other sections ("Saved", "Test sent"); failures in their own words.

### Testing Decisions

- As now: Vitest, the local Supabase stack as a real principal through `tests/support/supabase.ts`, components through `renderToStaticMarkup` with `vi.stubEnv` then `await import`. The push service is a fake, injected into the Edge Function as `sendPush`, as Google's HTTP API is; it is outside HTTP like the others. Never mock the database.
- Data (`tests/push-subscriptions.test.ts`): a Household Account saves a subscription and reads it back without `p256dh` and `auth`; saving the same endpoint keeps preferences; the same endpoint saved by another Household Account moves to it; a Device and an anonymous session cannot save, read, update or delete; one Household Account cannot see or change another's; insert is refused at the grant; only the five preference columns update; bad endpoints and `reminder_minutes` outside the five values are refused; removing a Household Account deletes its subscriptions; `list_items.added_by` is the inserter for a Household Account and for a Device and cannot be written by a client; `push_deliveries` is unreadable by clients; the prune removes deliveries older than 2 days.
- Sender (`tests/push-notify.test.ts`), with a fake `sendPush` and a fixed `now`, scoped by `householdId`: a reminder inside the window is sent once and never twice across two runs; outside the window, all-day, unselected calendars and past events are not; the lead time per subscription is honoured; the morning summary is sent once between 7:00 and 10:00 in the Household Timezone (a Household in a zone far from UTC, across a DST change) and not after 10:00; its body lists events and meals as specified; the Routines nudge lists only Profiles with Routines left, respects `days_of_week` and completions, and is not sent when all are done or after 22:00; list additions batch, skip the adder, include a Device's additions, skip crossed-off and too-new items; each kind respects its switch; `'gone'` deletes the subscription; a removed account's subscriptions get nothing; the run refuses a wrong or missing `x-push-secret`; `/test` sends only to the caller's own subscription and refuses a Device, a stranger and another account's endpoint; `/key` answers the key. Payload limits and words are unit-tested as pure functions.
- Phone: `pushSupport` unit-tested over fake navigators (Android Chrome, iPhone Safari tab, iPhone Home Screen app, desktop without `PushManager`); the card through `renderToStaticMarkup` in every state; `public/sw.js` loaded into a fake service-worker global in a unit test that fires `push` (good and malformed payloads always show a notification) and `notificationclick` (focuses or opens the url).
- Real phones are checked by hand after the deploy: Android Chrome and an iPhone on the Home Screen, "Send a test", and one of each kind. Agents do not put a session token into a browser.

### Deploy

- Order: push the migration, set the three function secrets, deploy `push-notify`, add the two Vault secrets (`push_notify_url`, `push_notify_secret`), then merge. Until the Vault secrets exist the minute's job does nothing, so any order up to there is safe. The VAPID pair is generated once with `generateVapidKeys` + `exportVapidKeys` and never changes; changing it would end every subscription.
- `docs/go-live.md` gains these steps.

## Out of Scope

- Choosing the summary and nudge times, or quiet hours.
- Reminders per event, or only for some people's events.
- Notifications on the Wall's tablets, by email or by text.
- Badges on the app icon, actions on a notification (Done, Snooze).
- Retrying a failed send.
- Telling people about removals, changes or crossings-off on lists; only additions to the Pinned List.

## Further Notes

- Apple does not offer Home Screen web apps in the EU since iOS 17.4, so iPhones there cannot get these notifications. Android is unaffected.
- Built while other sessions work on accessibility (#67, #93), words (#69) and calendar follow-ups (#125, #127). They meet this work in `SettingsPage.tsx` and the docs; whichever merges second resolves those lines.
