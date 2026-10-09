# Nidus

A wall-mounted household calendar: a Vite + React PWA on Netlify, Supabase for everything server-side. One household, an Android tablet in Fully Kiosk Browser, Google and iPhone (iCloud) calendars mirrored read-only.

## Read first

- `CONTEXT.md` is the glossary. Use its terms (Household, Household Account, Profile, Device, Appearance, Calendar Account, Mirrored Calendar, Synced Event, Native Event, Routine, Routine Completion, Shared List, Meal) in code, tests, issues and PRs.
- `docs/PLAN.md` holds every settled decision, the table list and the milestone order.
- `docs/adr/` holds the load-bearing decisions: Supabase over a custom backend, a read-only calendar mirror, and iCloud calendars by their public link. Do not reopen them in a ticket.
- `docs/specs/0001-nidus-v1.md` is the v1 spec; GitHub issue #1 is its tracker copy, and its sub-issues are the tickets.
- `docs/specs/0002-skylight-gaps.md` is the v2 spec, cut from the comparison in `docs/skylight-comparison.md`; its tracker copy and tickets are named in its opening paragraph.
- `docs/specs/0003-the-look.md` is the v3 spec: the look, in a light and a dark mode. `docs/look.md` is the source for every colour, type size and shared part; read it before touching anything a person sees.
- `docs/specs/0004-the-wall-on-a-phone.md` is the v4 spec: the Wall below 768 px wide, with five tabs at the foot.
- `docs/specs/0005-iphone-calendars.md` is the v5 spec: iPhone (iCloud) calendars mirrored from their public link.
- `docs/specs/0006-household-invites.md` is the v6 spec: more than one Household Account, joined by a Household Invite link.
- `docs/specs/0007-push-notifications.md` is the v7 spec: Web Push notifications to the grown-ups' phones, per phone, four kinds.
- `docs/specs/0008-deeper-modules.md` is the v8 spec: deeper modules (the Household clock, one synced read, day events, the paged view, the card write guard, calendar provider adapters), with no visible change beyond its rulings.
- `docs/specs/0009-the-wall-in-portrait.md` is the v9 spec: the Wall on a tablet hung upright (768 px and wider, taller than wide), with the Lenovo Tab P12 as the tablet.
- `docs/specs/0010-the-wall-on-a-24-inch-screen.md` is the v10 spec: the Wall on an Elo 2402L touch monitor (24 inches, 1920 by 1080) on a Windows PC, hung either way; `docs/windows-kiosk.md` is its set-up.
- `docs/specs/0011-deeper-screens.md` is the v10 spec: deeper screens (the Shared List card, the Meal Plan, event words, the Wall's routes, the read state, the lib client), continuing v8 one layer up, with one visible fix.

## Conventions

- pnpm, TypeScript strict, Vitest. Supabase CLI with the local Docker stack; every schema change is a committed migration under `supabase/migrations/`.
- Tests run through one seam: the Supabase JS client against the local stack, acting as a real principal (Household Account, Device, anonymous). The outside HTTP the Edge Functions make (Google's API, an iCloud calendar's feed, the Web Push service) is the only fake, injected into the function. Never mock the database.
- Row-level security on every table; `current_household_id()` is the one helper policies use. A Device may write only Native Events, Routine Completions, list items, Meals and its own heartbeat.
- All date logic uses the Household Timezone. Never use the machine's local zone.
- Two modes, light and dark, from one set of tokens (`docs/look.md`). The mode is the document's `data-mode`; no component branches on it for colour. WCAG AAA contrast in both, 48 px minimum touch targets, 16:10 on the Wall in landscape or portrait (`docs/look.md` "Portrait"), and a phone layout below 768 px wide or 544 px tall (`docs/specs/0004-the-wall-on-a-phone.md`, `docs/look.md` "The phone"; the `phone:` variant, never a width media query).
- The chrome is neutral and colour belongs to people. Nothing is told by colour alone: a person is a disc with their initial.
- Words the family reads are plain (people, tablets, lists, time zone); the glossary's terms are for code, tests, issues and PRs.
- No em-dashes in user-facing copy.

## Agent skills

- Issue tracker: GitHub issues via `gh`. See `docs/agents/issue-tracker.md`.
- Triage labels: the five canonical roles, each label string equal to its name. See `docs/agents/triage-labels.md`.
- Domain docs: single context, `CONTEXT.md` and `docs/adr/` at the repo root.
