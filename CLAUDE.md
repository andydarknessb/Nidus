# Nidus

A wall-mounted household calendar: a Vite + React PWA on Netlify, Supabase for everything server-side. One household, an Android tablet in Fully Kiosk Browser, Google Calendar mirrored read-only.

## Read first

- `CONTEXT.md` is the glossary. Use its terms (Household, Household Account, Profile, Device, Calendar Account, Mirrored Calendar, Synced Event, Native Event, Routine, Routine Completion, Shared List, Meal) in code, tests, issues and PRs.
- `docs/PLAN.md` holds every settled decision, the table list and the milestone order.
- `docs/adr/` holds the two load-bearing decisions: Supabase over a custom backend, and a read-only calendar mirror. Do not reopen them in a ticket.
- `docs/specs/0001-nidus-v1.md` is the v1 spec; GitHub issue #1 is its tracker copy, and its sub-issues are the tickets.
- `docs/specs/0002-skylight-gaps.md` is the v2 spec, cut from the comparison in `docs/skylight-comparison.md`; its tracker copy and tickets are named in its opening paragraph.

## Conventions

- pnpm, TypeScript strict, Vitest. Supabase CLI with the local Docker stack; every schema change is a committed migration under `supabase/migrations/`.
- Tests run through one seam: the Supabase JS client against the local stack, acting as a real principal (Household Account, Device, anonymous). Google's HTTP API is the only fake, injected into the Edge Function. Never mock the database.
- Row-level security on every table; `current_household_id()` is the one helper policies use. A Device may write only Native Events, Routine Completions, list items, Meals and its own heartbeat.
- All date logic uses the Household Timezone. Never use the machine's local zone.
- Dark theme only, WCAG AAA contrast, 48 px minimum touch targets, landscape 16:10.
- No em-dashes in user-facing copy.

## Agent skills

- Issue tracker: GitHub issues via `gh`. See `docs/agents/issue-tracker.md`.
- Triage labels: the five canonical roles, each label string equal to its name. See `docs/agents/triage-labels.md`.
- Domain docs: single context, `CONTEXT.md` and `docs/adr/` at the repo root.
