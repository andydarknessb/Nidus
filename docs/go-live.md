# Go live

An ordered checklist for putting Nidus on the wall. Every step is yours to do by hand: it touches a hosted account, a secret or the tablet. Work top to bottom; later steps depend on earlier ones.

Placeholders: `<project-ref>` is your Supabase project reference. `<site>` is your Netlify site's host name without the scheme (for example `nidus-home.netlify.app`), so `https://<site>` is the site's URL.

## 1. Netlify: create the site first

Steps 2, 3 and 5 need the site's URL, so fix it before anything else.

1. Create the site from this repository, production branch `master`. `netlify.toml` already sets the build command, the publish directory and the single-page redirect.
2. Site settings, Domain management: note the site's host name (or set a custom one now). That is `<site>`.
3. Do not deploy yet; the environment variables come in step 9.

## 2. Google Cloud console: production OAuth clients

Two OAuth clients, both type Web application, in the same project as `docs/google-sign-in.md`. Publish the consent screen (move it out of Testing) so refresh tokens do not expire after seven days.

1. Sign-in client: authorised JavaScript origin `https://<site>`; authorised redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`.
2. Calendar client (the one `calendar-connect` and `calendar-sync` use, with the Calendar API enabled): authorised redirect URI `https://<project-ref>.supabase.co/functions/v1/calendar-connect/callback`.
3. Keep both client IDs and secrets for the steps below.

## 3. Supabase dashboard: the hosted project

1. Create a project and note the database password and the project reference.
2. Database, Extensions: confirm `pg_cron`, `pg_net` and `supabase_vault` are enabled. The migrations ask for them, so this is only a check.
3. Authentication, Providers, Google: turn it on with the sign-in client's ID and secret.
4. Authentication, URL Configuration: Site URL `https://<site>`, and add `https://<site>/**` to the redirect URLs.

## 4. Push the migrations

```sh
pnpm supabase login
pnpm supabase link --project-ref <project-ref>
pnpm supabase db push
```

`db push` applies every file under `supabase/migrations/`, in order. That includes the `calendar-sync` and `nightly-prune` cron jobs.

## 5. Secrets

Function secrets, the five values the two functions read (see `supabase/.env.example`):

```sh
pnpm supabase secrets set \
  GOOGLE_CALENDAR_CLIENT_ID=<calendar client id> \
  GOOGLE_CALENDAR_CLIENT_SECRET=<calendar client secret> \
  CALENDAR_STATE_SECRET=<random, 32+ characters> \
  CALENDAR_SYNC_SECRET=<random, 32+ characters> \
  APP_URL=https://<site>
```

Vault secrets, in the dashboard's SQL editor, so the schedule can reach the function (see `docs/calendar-sync.md`). The second value is the same as `CALENDAR_SYNC_SECRET`:

```sql
select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/calendar-sync', 'calendar_sync_url');
select vault.create_secret('<the same value as CALENDAR_SYNC_SECRET>', 'calendar_sync_secret');
```

Until both Vault secrets exist, the `calendar-sync` job does nothing.

## 6. Deploy the functions

```sh
pnpm supabase functions deploy calendar-connect
pnpm supabase functions deploy calendar-sync
```

## 7. Check both cron jobs

In the SQL editor:

```sql
select jobname, schedule, active from cron.job order by jobname;
```

It lists `calendar-sync` (`*/5 * * * *`) and `nightly-prune` (`0 3 * * *`), both active.

A row in `cron.job_run_details` only says the job ran: for `calendar-sync` it means the request was queued, not that the function accepted it. After five minutes, read the function's answer:

```sql
select status_code, content, created from net._http_response order by created desc limit 5;
```

`status_code` 200 with a body like `{"accounts":1,...,"errors":[]}` is healthy. A 401 means `calendar_sync_secret` does not match `CALENDAR_SYNC_SECRET`; no rows at all means a Vault secret is missing. Connect a Calendar Account first (step 9) if the body reports zero accounts.

The prune shows up in `select * from cron.job_run_details order by start_time desc limit 5;` after its first 03:00 UTC.

## 8. Hosted Auth settings

Authentication, Sign In / Providers:

1. Anonymous sign-ins: on. The wall's Device is an anonymous session until it is paired.
2. Email provider: off. Google is the only way in for a Household Account.

To confirm the second, `supabase.auth.signInWithPassword` against the hosted project must fail with `AuthApiError.code === 'email_provider_disabled'`. The local stack keeps its email provider on, because the tests sign in with a password: `pnpm test` stays green locally.

## 9. Netlify: environment and production deploy

1. Site settings, Environment variables: `VITE_SUPABASE_URL=https://<project-ref>.supabase.co` and `VITE_SUPABASE_ANON_KEY=<the project's anon key>`.
2. Deploy from `master`.
3. Open `https://<site>` and sign in with Google at `https://<site>/settings`. On the Calendars tab, connect a Google calendar (a Calendar Account) and choose which of its calendars to show (the Mirrored Calendars).

## 10. Installability

Lighthouse no longer has a Progressive Web App category, so check installability in Chrome. Open `https://<site>`, DevTools, Application, Manifest: the Installability section lists no errors, and the manifest shows the name, start URL, `display: standalone` and the 192 px and 512 px icons. Chrome's address bar also offers an Install button. There is no service worker and no offline support, by design.

## 11. Pair the tablet

1. Set the tablet up as in `docs/fully-kiosk.md`, with the production start URL.
2. The wall shows a six-character Pairing Code.
3. On a phone, open `https://<site>/settings`, go to Wall tablets and Pair a tablet, enter the code and a name for the tablet, and pair it.
4. The wall switches to the home screen within seconds.
