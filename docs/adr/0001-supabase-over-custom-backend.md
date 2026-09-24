---
status: accepted
date: 2026-09-24
---

# Supabase instead of a custom NestJS + Redis + BullMQ + Socket.io backend

The original blueprint specified a NestJS API, Redis, BullMQ workers, a Socket.io push layer and Docker deployment. Nidus serves one household on one or two wall tablets, so that is four services to operate for a fridge calendar. We use Supabase for everything server-side: Postgres with row-level security, Auth (Google sign-in for the Household Account, anonymous sessions for paired Devices), Realtime for change notification, Edge Functions for the Google OAuth consent flow and calendar sync, Vault for refresh tokens, and pg_cron for scheduled sync and pruning. The frontend is a Vite + React SPA on Netlify; there is no Next.js because nothing is server-rendered.

## Consequences

- No job queue: the 5-minute sync and nightly prune are pg_cron invocations of Edge Functions. If sync ever needs retries, backoff or fan-out beyond one household, that is the point to revisit this.
- Multi-tenancy is preserved by `household_id` on every row and RLS, not by a service layer.
- Swapping Supabase out later means rewriting auth, realtime and the sync functions together.
