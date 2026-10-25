# Nidus v13: deeper modules, round four

Tracker: GitHub issue #254; its sub-issues #255 to #260 are the tickets. Vocabulary: [CONTEXT.md](../../CONTEXT.md) (Household, Household Account, Profile, Device, Shared List, Routine, Native Event, Occurrence, Meal). Decisions: [PLAN.md](../PLAN.md) ("v13: deeper modules, round four"). [ADR 0006](../adr/0006-one-change.md) records the one decision that outlives this round. It continues [0008](0008-deeper-modules.md), [0011](0011-deeper-screens.md) and [0012](0012-deeper-modules-round-three.md): the same rulings (no visible change, replace don't layer, plain TypeScript cores with thin hooks, facts not sentences, props not a context) apply to every ticket here.

## Problem Statement

An architecture review on 2026-10-24 walked master, six read-only sweeps, and found the next six places where one rule is written in two or more, and where the wiring between tested pure parts is itself untested.

- **The change.** The guard, the write, the read-back and the words are re-decided three ways: a change at a place (the Settings cards, the event form), a page-wide wrapper with one failure string (the Routines and Lists pages), and a sheet's own `busy` and `problem` flags (the Meal sheet). Only the change itself is driven by a test; the page wrappers' decisions are not.
- **The form that takes a row's place.** Seven forms re-decide one lifecycle: the asked-for-name count and its words, the busy guard, the problem placed beside the field, and where focus goes when the row swaps back. `unnamed` exists, but the rest is copied, and "as in AdminApp" is written beside a second copy of the session reader.
- **The card's read.** Five Settings cards each compute `loadProblem` and draw their own `<p role="alert">`, though `ReadState` says it is the only place those words and that role are spelt. `SharedListsPage` and `RoutinesPage` also declare the card's look again, as strings that already exist in the card module.
- **The Wall's routes.** `useWallRoute` returns a six-slot positional tuple, which the shell unpacks into five callbacks threaded separately through the navigation rail, `PhoneShell` and `PhoneTabs`; `PhoneWall` lists the same component in three cases.
- **The shelf.** The Routines chart and the Lists screen each hand-build the same shelf: the heading row and its More button, the sideways row, the portrait grid, the shared More foot, and the `contents` wrapper that keeps a column mounted when the tablet turns. The comment explaining that wrapper is written twice.
- **The shared folder's name.** The client reaches its Household clock and its event words through 36 relative paths across 29 files into `supabase/functions/`, so the seam between the Wall and the Edge Functions has no name and the client's module graph includes the server's folder.

## Solution

Six modules, each with a small interface where its callers already meet. Nothing the family sees changes: no words, colours, layouts or timings. The suite is the safety net, and every test of a helper that becomes internal moves to the new module's interface, case by case (replace, don't layer).

## User Stories

1. As a parent saving a list, a person, a tablet, a calendar or a Routine, I want a failure said where I am looking, as it is on every other screen, so that I never have to find a line at the top of a page.
2. As a parent who is asked to name something and does not, I want the same words, counted the same way, whichever form I am in.
3. As a person whose Settings read failed, I want the card I was reading to say so once, in the same place and with the same role, whichever card it is.
4. As a parent on a phone, I want the Calendar tab to open the week the Wall is on, and Back to work, as it does today.
5. As a family member turning the tablet, I want the Routines chart and the Lists screen to keep what they held, as they do today.
6. As an agent adding a shared module, I want one import name for it, so that the client never reaches into the Edge Functions' folder.
7. As a tester, I want the change, the form row, the navigator and the shelf each driven through one interface, so that a fix to one rule is tested in one place.
8. As a family member, I want nothing else to change.

## Implementation Decisions

### Rulings (settled with the owner, 2026-10-24, two rounds, every recommendation taken)

- **No visible change on the normal path.** Unlike v11, there is no fix. A write that did not go through is said at its place (beside the field or row, or in the page's line for an action with no row), which is ticket 1's user story; nothing else moves. The existing suite is the safety net.
- **Replace, don't layer**: a helper that becomes internal takes its tests with it; the old module and its tests are deleted. Every PR lists old test to new test. No case is dropped.
- **Plain TypeScript cores, thin hooks**: as v8, v10 and v11. No DOM test library; no mocked database.
- **Props, not a context**: [ADR 0004](../adr/0004-the-household-facts-are-props-not-a-context.md) stands. The change and the navigator are values passed down, never a context.
- **One spec, six tickets.** Order: #1, then #2, then #5 (the three that share `RoutinesPage.tsx` and `SharedListsPage.tsx`); #3 and #4 start in parallel on disjoint files; #6 lands last, after every other file has settled, because it sweeps imports.
- **The new nouns live here, not in `CONTEXT.md`.** `CONTEXT.md` stays a glossary of household things. A term enters it only when it is a household fact; "Change" is the only candidate, and it was not taken.
- **One ADR**: [ADR 0006](../adr/0006-one-change.md) for #1. The other five are internal, reversible, and recorded in these rulings.

### 1. The change

- `src/lib/change.ts` is the change: the card write guard (from `card-write.ts`), `createChange`, `useChange`, `WriteProblem`, `ChangeThen`, `FailWords`, `ChangeState` and the places. `src/lib/card-write.ts` is deleted.
- `src/lib/synced-read.ts` keeps the read: `startSyncedRead`, `useSyncedRead`, `SyncedState`, `SyncedRead`, `ReadStateName`, `REFRESH_MS`, `RETRY_MS` and `couldNotLoad`. `useSyncedRead` composes the change and its return type is `ReturnType<typeof useChange<T>>`.
- `useChange`'s members do not change: `change`, `problem(place)`, `say`, `fail`, `clear`, `busy`, `isBusy`, `focus`, `focused`. A call site that changes data imports from `lib/change`; one that reads imports from `lib/synced-read`.
- **Every action names a place.** A page keeps no page-wide failure string. An action with no row of its own names the page's line as its place, and the line carries the alert role.
  - The Lists page: `new-list`, `rename-<id>`, `delete-<id>`, `pin-<id>`, `reorder`.
  - The Routines page: `add-<profile id>`, `edit-<id>`, `archive-<id>`, `reorder`.
  - The Meal sheet: `meal`; the sheet takes `busy`, `problem('meal')`, `change('meal', work)` and `clear('meal')` from `useChange()` in place of its own `busy` and `problem` state.
  - The existing places (the Settings cards, the event form's `event`) stay as they are.
- The two `change(work, failure)` wrappers and the `changeProblem` state go; the pages call `read.change(place, …)` and `read.isBusy()` directly. The page's line for a failed *read* is not the change's and stays (`couldNotLoad`), as ADR 0006 says.
- Tests: the change's cases move from `tests/synced-read.test.ts` to `tests/change.test.ts`, with two new cases: two places' problems are independent and one clears without the other, and a `reorder` says at the page's line while a field's failure stays at its field.

### 2. The form row

- `src/lib/form-row.ts` is the plain core. `createFormRow({ what, opener })` holds the row's state and answers the one decision a form makes before it writes:
  - `state()`: `{ id: string | null; asked: number }`, null when the row is closed.
  - `start(id)`: opens the row (or the always-on form's own id) and resets `asked`.
  - `close()`: closes it and returns the focus id of the control that opened it.
  - `ask(name)`: counts an ask and returns `{ problem: Said }` while the name is empty (`unnamed`, so the words are the ones the page already uses), else `'go'`.
- `src/lib/use-form-row.ts` is the thin hook: `useFormRow({ what, place, read, opener })` returns `open`, `start`, `close`, `nameProblem`, `submit(name, work, then)`, and the read's change members. `submit` asks first and, on `'go'`, calls `read.change(place(id), work, then)`. A null `name` skips the ask (a form that asks for no name).
- A form that stays open simply does not call `close()`: an add form that clears its fields and stays, as the New list card and the Routine add form do. `then.landed` keeps returning a focus id, as it does today; it does not widen.
- Seven forms: New list and Rename list (`SharedListsPage.tsx`), Add person and Edit person (`ProfilesSection.tsx`), Pair a tablet (`DevicesSection.tsx`), the iPhone calendar link (`CalendarAccountsSection.tsx`), and Routine add and edit (`RoutinesPage.tsx`). The Household name and time zone form, the Meal sheet and the Add event sheet are out: their outcome is a status line or a sheet, not a row that swaps back.
- Tests: `tests/form-row.test.ts` drives the core (an ask with no name, an ask after a name, close and its focus, the always-on form that never closes) and the hook's `submit` against a recorded change. The forms' markup cases stay in `tests/phone-settings.test.ts`.

### 3. The card's read

- `Card` in `src/components/phone.tsx` gains `read?: { failed: boolean }`, `of: string` and `words?: string`, and draws the lost-connection line at the top of the card, with `role="alert"`. It uses `couldNotLoad(of)`, or `words` when a card's sentence is its own. A card with no read draws nothing.
- The five sections drop `loadProblem` and their own alert: `DevicesSection`, `ProfilesSection`, `CalendarAccountsSection`, `EventsSection`, `NotificationsSection`. Notifications passes `words={LOAD_FAILED}`.
- `SharedListsPage` and `RoutinesPage` use `cardClass` and `Card`'s title from the card module instead of their own `CARD` and `CARD_TITLE` strings. A section whose label is a list's or a person's name keeps its `aria-label` shape and takes the look from `cardClass`.
- Tests: a new `tests/card.test.ts` renders a card that is loading, failed and ready, with and without its own words. The sections' markup cases stay where they are.

### 4. The navigator

- `src/lib/wall-routes.ts` gains `WallNavigator`, `{ open(view, date); home(); routines(); meals(date); lists() }`, and a pure `navigatorFor(go: (path: string) => void)`, so the object is tested with a recording `go`. `useWallRoute` becomes the popstate and `pushState` wiring around it and returns `[route, navigator]`.
- `NavigationRail` takes `navigator` in place of `onOpen`, `onHome`, `onRoutines`, `onMeals` and `onLists`, and keeps `route`, `timezone`, `owner`, `onAdd` and `onToggleMode`.
- `PhoneTabs` and `PhoneShell` take `navigator` in place of the same five; `PhoneScreenProps` carries `navigator` in place of `openView`, `openRoutines`, `openLists` and `openMeals`. Every phone screen uses the navigator.
- `PhoneWall` draws `PhoneCalendar` once for `day`, `week` and `month` in one branch (`PhoneCalendar` already narrows `route`).
- Tests: `tests/wall-routes.test.ts` gains the navigator's cases (each method writes the path `wallPath`, `mealsPath`, `/`, `/routines` and `/lists` write, and no path is written when it is already the address). The screens' markup cases pass the navigator.

### 5. The shelf

- `src/components/Shelf.tsx` is the shelf. Its interface: `Shelf({ title, controls, of, portrait, items })`. `title` is the screen's own heading element (its id, its ref and its focus-on-arrival stay the screen's); `controls` is the heading row's controls (the part-of-day group, or nothing); `of` is the noun the More words count (`people`, `lists`); `portrait` is the Wall's one read of the window; `items` are the columns or cards.
- The shelf owns the `useOverflow` for the row, the heading row's More button (not in portrait), the sideways row with the `contents` wrapper, the portrait grid, the shared More foot, and the scroller ref. The screens keep their own `useOverflow` for a column's foot (the chart's `Column`).
- `RoutinesChart` and `ListsScreen` supply title, controls, `of`, `portrait` and items, and drop their own wrapper markup. Nothing else uses the shelf: the Sheet's body and a list card's foot use the same button but are not shelves.
- Tests: a new `tests/shelf.test.ts` renders both layouts and pins the heading row, the `contents` wrapper, the portrait grid and the foot; `tests/routines-chart.test.ts` and `tests/lists-screen.test.ts` keep their cases.

### 6. The shared folder's name

- `@shared/*` is aliased to `supabase/functions/_shared/*` in `tsconfig.app.json` (`paths`), `vite.config.ts` and `vitest.config.ts`. The specifier keeps its extension, as the imports do today: `@shared/zoned-time.ts`, `@shared/event-words.ts`.
- All client and test imports of `zoned-time.ts` and `event-words.ts` are swept to `@shared/…`. Nothing moves; the Edge Functions keep their `../_shared/…` imports, so the deploy path is untouched.
- The alias exposes the folder's other modules too. The client imports only the pure ones; that boundary is held by review, not by the alias. No ADR: the alias is reversible.
- Tests: no new cases. `pnpm typecheck` and the suite cover the sweep.

## Tickets

1. **One change: every screen writes through the change, at a place.** (#255) `lib/change.ts` (new), `lib/card-write.ts` (deleted), `lib/synced-read.ts`, `RoutinesPage.tsx`, `SharedListsPage.tsx`, `MealsPage.tsx`, the sections and sheets that import a change type; `tests/change.test.ts` (new), `tests/synced-read.test.ts`.
2. **A form that takes a row's place has one lifecycle.** (#256) `lib/form-row.ts`, `lib/use-form-row.ts` (new), the seven forms; `tests/form-row.test.ts` (new), `tests/phone-settings.test.ts`.
3. **A card says when its own read failed, in one place.** (#258) `components/phone.tsx`, `DevicesSection`, `ProfilesSection`, `CalendarAccountsSection`, `EventsSection`, `NotificationsSection`, `RoutinesPage`, `SharedListsPage`; `tests/card.test.ts` (new).
4. **The Wall navigates by a navigator's names.** (#259) `lib/wall-routes.ts`, `WallPage.tsx`, `NavigationRail.tsx`, `PhoneShell.tsx`, `PhoneWall.tsx`, `src/phone/*`; `tests/wall-routes.test.ts`, the screens' markup cases.
5. **The chart and the Lists screen share one shelf.** (#257) `components/Shelf.tsx` (new), `RoutinesPage.tsx`, `SharedListsPage.tsx`; `tests/shelf.test.ts` (new), `tests/routines-chart.test.ts`, `tests/lists-screen.test.ts`.
6. **The client names the shared folder once.** (#260) `tsconfig.app.json`, `vite.config.ts`, `vitest.config.ts`, every importer of the two shared modules under `src` and `tests`.

## Schema

No migration.
