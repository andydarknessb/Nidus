# Nidus — v1 plan

Settled in the design grilling on 2026-09-24. Vocabulary lives in [CONTEXT.md](../CONTEXT.md); the two load-bearing decisions are ADRs [0001](adr/0001-supabase-over-custom-backend.md) and [0002](adr/0002-read-only-calendar-mirror.md).

## Decisions

- **Audience**: one household (ours), on one or two Android tablets in landscape running Fully Kiosk Browser. `household_id` on every row keeps multi-tenancy possible without building it.
- **Principals**: one Household Account (Supabase Auth, Google sign-in, identity scope only). Profiles are people with no credentials. Devices are anonymous Supabase sessions linked to the Household by pairing (tablet shows a code, parent claims it from a signed-in phone). Devices read everything, tick Routines and list items, and manage Native Events; administration is phone-only.
- **Email sign-up**: off in production, so Google is the only way in for a Household Account. On in the local stack, because the test seam signs in with a password as the stand-in for Google.
- **Routes and anonymous sign-ins**: the tablet opens `/` (the wall: a Pairing Code until paired, then the home screen); administration lives at `/settings` and is phone-only, refusing any Device session. Anonymous sign-ins must be on (`enable_anonymous_sign_ins` in `supabase/config.toml` locally; Authentication settings on the hosted project, milestone 4), and `ensure_household` rejects anonymous sessions so a tablet can never own a Household. The Netlify SPA fallback for `/settings` lands with the deploy ticket.
- **Stack**: Vite + React + Tailwind + shadcn on Netlify. Supabase for Postgres, RLS, Auth, Realtime, Edge Functions, Vault, pg_cron. pnpm, TypeScript strict, Vitest, Supabase CLI with local Docker stack, migrations in-repo.
- **Calendar**: Google only. Per-Calendar-Account consent via Edge Function with `calendar.readonly` + offline access; refresh tokens in Vault. Poll every 5 minutes with syncToken; no webhooks. Recurring events stored as expanded occurrences in a window of −1 month / +6 months. Attribution lives on the Mirrored Calendar (Profile or household), never per event.
- **Sync edge cases**: cancelled occurrence → delete row; calendar unselected → delete its rows; 410 → full resync in one transaction; token revoked → Calendar Account `needs_reauth`. Wall shows a "last synced" badge once an account is more than an hour behind.
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
