# Go live

An ordered checklist for putting Nidus on the wall. Every step is yours to do by hand: it touches a hosted account, a secret or the tablet. Work top to bottom; later steps depend on earlier ones.

Replace `<project-ref>` with your Supabase project reference and `<site>` with your Netlify site's URL.

## 1. Google Cloud console: production OAuth clients

Two OAuth clients, both type Web application, in the same project as `docs/google-sign-in.md`. Publish the consent screen (move it out of Testing) so refresh tokens do not expire after seven days.

1. Sign-in client: authorised JavaScript origin `https://<site>`; authorised redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`.
2. Calendar client (the one `calendar-connect` and `calendar-sync` use, with the Calendar API enabled): authorised redirect URI `https://<project-ref>.supabase.co/functions/v1/calendar-connect/callback`.
3. Keep both client IDs and secrets for the steps below.

## 2. Supabase dashboard: the hosted project

1. Create a project and note the database password and the project reference.
2. Database, Extensions: confirm `pg_cron`, `pg_net` and `supabase_vault` are enabled. The migrations ask for them, so this is only a check.
3. Authentication, Providers, Google: turn it on with the sign-in client's ID and secret.
4. Authentication, URL Configuration: Site URL `https://<site>`, and add `https://<site>` to the redirect URLs.

## 3. Push the migrations

```sh
pnpm supabase login
pnpm supabase link --project-ref <project-ref>
pnpm supabase db push
```

`db push` applies every file under `supabase/migrations/`, in order. That includes the `calendar-sync` and `nightly-prune` cron jobs.

## 4. Secrets

Function secrets (the three the functions read, see `supabase/.env.example`):

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

## 5. Deploy the functions

```sh
pnpm supabase functions deploy calendar-connect
pnpm supabase functions deploy calendar-sync
```

## 6. Check both cron jobs

In the SQL editor:

```sql
select jobname, schedule, active from cron.job order by jobname;
```

It lists `calendar-sync` (`*/5 * * * *`) and `nightly-prune` (`0 3 * * *`), both active. After five minutes, `select * from cron.job_run_details order by start_time desc limit 5;` shows the sync ran and succeeded. The prune shows up there after its first 03:00 UTC.

## 7. Hosted Auth settings

Authentication, Sign In / Providers:

1. Anonymous sign-ins: on. The wall's Device is an anonymous session until it is paired.
2. Email provider: off. Google is the only way in for a Household Account.

To confirm the second, `supabase.auth.signInWithPassword` against the hosted project must fail with `AuthApiError.code === 'email_provider_disabled'`. The local stack keeps its email provider on, because the tests sign in with a password: `pnpm test` stays green locally.

## 8. Netlify: environment and production deploy

1. Create the site from this repository, production branch `master`. `netlify.toml` already sets the build command, the publish directory and the single-page redirect.
2. Site settings, Environment variables: `VITE_SUPABASE_URL=https://<project-ref>.supabase.co` and `VITE_SUPABASE_ANON_KEY=<the project's anon key>`.
3. Deploy from `master`.
4. Open `https://<site>` and sign in with Google at `https://<site>/settings`. Connect a Calendar Account and choose Mirrored Calendars.

## 9. Lighthouse: installable

In Chrome, open `https://<site>`, DevTools, Lighthouse, tick Progressive Web App, and run it. The Installable checks pass: a web manifest with a name, a start URL, `display: standalone` and 192 px and 512 px icons. There is no service worker and no offline support, by design.

## 10. Pair the tablet

1. Set the tablet up as in `docs/fully-kiosk.md`, with the production start URL.
2. The wall shows a six-character Pairing Code.
3. On a phone, open `https://<site>/settings`, Devices, enter the code and a name for the tablet, and claim it.
4. The wall switches to the home screen within seconds.
