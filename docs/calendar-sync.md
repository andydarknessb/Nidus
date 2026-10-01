# Calendar sync

The `calendar-sync` Edge Function mirrors every selected Mirrored Calendar into Synced Events. pg_cron calls it every five minutes; you can also call it by hand. The design is in [ADR 0002](adr/0002-read-only-calendar-mirror.md) and `docs/PLAN.md` (Calendar).

## What a run does

For each Calendar Account whose status is `active`:

1. Reads the refresh token from Vault and trades it for an access token. If Google says the token is revoked (`invalid_grant`) the account becomes `needs_reauth` and is skipped until the parent reconnects it.
2. Fully syncs each **selected** Mirrored Calendar with `singleEvents=true` over a window of one month back to six months ahead, so recurring events arrive as separate occurrences. The rows are replaced in one transaction (`replace_synced_events`): changed occurrences update, gone or cancelled ones are deleted, and the returned sync token is stored on the calendar.
3. Clears the events of calendars that are no longer selected.
4. Sets `last_synced_at` and clears `last_error` on the account. If a calendar failed, the account keeps `last_error` and that calendar keeps its previous events; the others still sync.

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

Set the three secrets with `supabase secrets set`, deploy with `supabase functions deploy calendar-sync`, and create the two Vault secrets with the project's own function URL (`https://<project-ref>.supabase.co/functions/v1/calendar-sync`). Applying the migration schedules the job; creating the Vault secrets is what turns it on.
