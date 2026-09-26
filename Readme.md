# Nidus

A wall-mounted household calendar. See `CLAUDE.md` for the map of the docs and `docs/PLAN.md` for every settled decision.

## Prerequisites

- Node 22 or newer, with corepack (ships with Node). Run `corepack enable` once from an elevated shell; until then, prefix commands with `corepack`, e.g. `corepack pnpm install`.
- Docker Desktop, running. The Supabase CLI is a dev dependency and needs Docker for the local stack.

## Commands

```
pnpm install        # dependencies, including the Supabase CLI
pnpm db:start       # local Supabase stack (Postgres, Auth, PostgREST, Studio) with migrations applied
pnpm dev            # Vite dev server
pnpm test           # Vitest, against the running local stack
pnpm lint           # ESLint
pnpm typecheck      # tsc --noEmit
pnpm db:reset       # re-apply every migration from scratch
pnpm db:stop        # stop the stack
```

`pnpm ci` runs lint, typecheck and the tests in that order.

## How tests work

Tests exercise one seam: the Supabase JS client against the local stack, acting as a real principal (Household Account, Device, anonymous). The fixture in `tests/support/supabase.ts` reads the stack's keys from `supabase status`, or from `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` when set. Nothing mocks the database.

## Schema

Every schema change is a migration under `supabase/migrations/`, applied to the local stack. There is no hosted project until the final milestone.

## Sign-in

The Household Account signs in with Google. To run it locally, create the OAuth client and set the env files as described in `docs/google-sign-in.md`.
