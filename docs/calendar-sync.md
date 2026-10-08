# Calendar sync

The `calendar-sync` Edge Function mirrors every selected Mirrored Calendar into Synced Events. pg_cron calls it every five minutes; you can also call it by hand. The design is in [ADR 0002](adr/0002-read-only-calendar-mirror.md) and `docs/PLAN.md` (Calendar).

## What a run does

For each Calendar Account whose status is `active`:

1. Reads the refresh token from Vault and trades it for an access token. If Google says the token is revoked (`invalid_grant`) the account becomes `needs_reauth` and is skipped until the parent reconnects it.
2. Syncs each **selected** Mirrored Calendar, in one of two ways:
   - **Full read** (the first time, once a day, and after a 410): `singleEvents=true` over a window of one month back to six months ahead, so recurring events arrive as separate occurrences. The rows are replaced in one transaction (`replace_synced_events`): changed occurrences update, gone or cancelled ones are deleted, and the returned sync token and the time of the read are stored on the calendar. The daily full read is what brings in occurrences that slide into the window, which a delta never reports.
   - **Incremental** (every other run): asks Google only for what changed since the stored sync token (no window; Google refuses one with a token). Moved and renamed events update in place, cancelled events and cancelled single occurrences are deleted, anything that moved outside the window is dropped, all in one transaction (`apply_synced_event_changes`).
3. A 410 from Google on an incremental read means the sync token has expired: the token is cleared and that calendar is read in full. The old rows stay until the full read has succeeded, so the wall never shows a partly emptied calendar.
4. Calendars that are not selected are not read. Un-selecting one removes its events (and its sync token) in the same statement, through a trigger, so the wall loses them at once rather than at the next run; selecting it again means a full read on the next run.
5. Sets `last_synced_at` and clears `last_error` on the account. If a calendar failed, the account keeps `last_error` and that calendar keeps its previous events and token; the others still sync.

Google accounts are synced first in each run. Then iPhone (iCloud) accounts, a Calendar Account of provider `icloud` with one Mirrored Calendar ([ADR 0003](adr/0003-icloud-by-public-link.md), spec 0005), in the order they were last attempted (never-attempted first); each one's `last_attempted_at` is written before its feed is read, so a feed that stops a run goes to the back of the next one:

1. Reads the feed's link from Vault and fetches it (only iCloud hosts, at most three redirects, 15 s, 2 MB), with the stored ETag and Last-Modified unless the last full read is a day old. A 304 changes nothing and counts as synced; 401, 403, 404 or 410 makes the account `needs_reauth`; Settings says the link no longer works from that status and the provider, not from anything written in `last_error`.
2. Expands the feed with `ical.js` into occurrences over the same window: single events, added dates (RDATE) and moved occurrences first, then repeating series, newest first. Only the repeats an iPhone can make are expanded (DAILY, WEEKLY, MONTHLY, YEARLY without the parts that can make the library search without end, and INTERVAL up to 999); others show their first occurrence. Daily, weekly, monthly and yearly series without COUNT are fast-forwarded to the window, so a long history costs nothing; a series with COUNT, or one that cannot be moved, is walked from its first occurrence (a monthly rule with a position, such as the last weekday, only when it began at most 240 steps before the window, and never for more than those steps plus the window's length in months).
3. Work is capped: 30,000 steps per series, 60,000 per feed, 80,000 and 800 ms per run. A series cut by its own caps keeps what was reached and the account sets `truncated` ("Connected. Some repeating events cannot be shown in full." in Settings); a read that is whole clears it, and a 304 keeps it. A feed the run did not reach is left untouched (its row is not stamped or changed), so it keeps its old rows and its place in line.
4. Stores the rows with `replace_synced_events`, the validators (and whether the read was cut) as JSON in the calendar's `sync_token`.

Reconnecting an account that needs reauth (the "Connect again" button in settings) goes through `calendar-connect` like a first connection: it updates the Vault secret in place, sets the account `active` and keeps its Mirrored Calendars, Profiles and colours.

Settings shows each account's status, whether repeating events were cut short, and last-synced time. `last_error` is for the logs: Settings only uses it to say that an update failed. The wall shows a "Last synced N hours ago" badge only when an account is more than an hour behind.

All-day events are stored as midnight-to-midnight in the Household Timezone; timed events keep their instant. The wall reads both through the `calendar_occurrences` view.

## Secrets

The function reads three secrets (see `supabase/.env.example`):

| Secret | Notes |
| --- | --- |
| `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET` | The same OAuth client `calendar-connect` uses. |
| `CALENDAR_SYNC_SECRET` | Random, 32+ characters. Callers send it as the `x-sync-secret` header; without it the function answers 401. |

## Locally

Serve the functions with the env file, then call the function:

```sh
pnpm supabase functions serve --env-file supabase/.env

curl -X POST http://127.0.0.1:54321/functions/v1/calendar-sync \
  -H "x-sync-secret: $CALENDAR_SYNC_SECRET"
```

The response is `{"accounts":1,"calendars":2,"events":143,"errors":[]}`. A non-empty `errors` list names the account and what failed; the same text is on `calendar_accounts.last_error`.

To make the local pg_cron job call it too, give the job its target and secret as Vault secrets (run once in Studio's SQL editor or `psql`). From inside the database container the host is `host.docker.internal`:

```sql
select vault.create_secret('http://host.docker.internal:54321/functions/v1/calendar-sync', 'calendar_sync_url');
select vault.create_secret('<the same value as CALENDAR_SYNC_SECRET>', 'calendar_sync_secret');
```

Until both secrets exist the job does nothing, so a fresh stack is unaffected. To see what cron has done: `select * from cron.job_run_details order by start_time desc limit 5;`, and `select * from net._http_response order by created desc limit 5;` for the function's answers.

## Hosted

Set the three secrets with `supabase secrets set`, push the migrations first, then deploy with `supabase functions deploy calendar-sync` (and `calendar-connect`, which adds iPhone calendars), and create the two Vault secrets with the project's own function URL (`https://<project-ref>.supabase.co/functions/v1/calendar-sync`). Applying the migration schedules the job; creating the Vault secrets is what turns it on.
