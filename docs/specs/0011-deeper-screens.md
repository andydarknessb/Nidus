# Nidus v10: deeper screens

Tracker: GitHub issue #198; its sub-issues #199 to #205 are the tickets. Vocabulary: [CONTEXT.md](../../CONTEXT.md) (Household Date, Shared List, Pinned List, Meal, Meal Plan, Synced Event, Native Event, Profile Filter, Push Subscription). Decisions: [PLAN.md](../PLAN.md) ("v10: deeper screens"). ADRs 0001 to 0003 stand; nothing here reopens them. It continues [0008](0008-deeper-modules.md): the same rulings (no visible change, replace don't layer, plain TypeScript cores with thin hooks, facts not sentences) apply to every ticket here.

## Problem Statement

v8 deepened six modules under the screens. An architecture review on 2026-10-09 (the owner approved every ruling in two rounds) found the next layer up still copied: the screens compose the deep modules by hand, and the Wall and the phone each write the same card. The hot files of the last 150 commits are the screens (`WallPage.tsx` 15, `SharedListsPage.tsx` 12, `RoutinesPage.tsx` 10, `MealsPage.tsx` 9), so this is where the next change lands and where the next copied bug will be.

Six things, each in more than one place:

- **The Shared List card.** The Wall's card and the phone's card are the same composition line for line (heading and count, pinned mark, add row, rows, problem line, Clear). The "N to get" rule has two answers: the Wall shows "0 to get" from the items it holds after a failed read or write; the phone shows nothing until a read or write lands.
- **The Meal Plan.** The Wall's and the phone's week each rebuild the same seven steps (today, now, the paged view, open-a-week, the read span, the load ladder, the sheet model). The phone's `sheetFor` and `slotRowName` exist; the Wall writes its own copies of both, including the words a screen reader hears.
- **An event's time words.** Six places decide what an event's time says, with four clock formatters: the schedule pill, the day block, the month line (an inline rule), the details sheet, the Native Event form and push-notify's reminder and morning summary (a third copy of the pill rule, with its own 12-hour formatter). The clocks-go-back rule reaches two of the six.
- **The calendar read module holds four jobs.** `calendar-occurrences.ts` has 30 exports: reading occurrences, the Wall's routes, the month cell's fitting arithmetic, and clock and date words. The deletion test splits four ways.
- **The read ladder and the card change.** Five screens draw Loading / could not load / content by hand, with two spellings of "nothing read yet" (`loaded` on the Wall, `settled` on the phone). Three Settings pages copy a `change()` helper (card write, then write, then read back) with two return types; six other Settings cards call the card write and never read back.
- **How a lib reaches Supabase.** Six libs take the client as their first argument; three (`push.ts`, `device.ts`, `household-invites.ts`) import the singleton. The test seam is "a real principal through the client", so those three cannot be tested as a Device or a second Household Account; their tests import lazily to work around it.

## Solution

Each becomes one module with a small interface, at the place its callers already meet. The family sees one change:

- A list that could not be read or written says nothing about how many are left to get, on the Wall as on the phone. This fix ships first, on its own.

Everything else is invisible: no new words, colours, layouts or timings.

## User Stories

1. As a family member at the Wall, I want a list whose last read or write failed to show no count, as the phone does, so that the Wall never says "0 to get" about a list it could not read.
2. As a family member, I want the Wall's list card and the phone's to add, cross off and clear the same way, so that a fix to one is a fix to both.
3. As a family member, I want the Wall's Meal Plan and the phone's to page the same weeks, read the same span, and say the same words to a screen reader for an empty slot.
4. As a parent whose phone gets an event reminder, I want it to say the time the Wall shows for that event, including the night the clocks go back.
5. As a parent reading the morning summary, I want each line's time to be the schedule pill's words ("All day", "Until 12:30 AM", "8:30 AM"), not a second rule.
6. As a family member at any screen, I want "Loading" and "Could not load" to mean the same thing everywhere, including the moment just after Household midnight when the Routines have not been read for the new day.
7. As a parent in Settings, I want every card to show what the database holds after a change, not only the three that read back today.
8. As the owner, I want one Shared List card, one Meal Plan week, one event-words module, one route module, one read state and one way for a lib to reach Supabase, so that each rule is found in one place.
9. As an agent building a ticket, I want each module testable through its interface, with every test of a helper that becomes internal carried over case by case.
10. As a family member, I want nothing else to change.

## Implementation Decisions

### Rulings (settled with the owner, 2026-10-09)

- **The "N to get" fix first, alone**: the phone's rule wins. A list whose items are not loaded, or whose last read or write failed, shows no count (`leftToGet`). It ships to master as a bug fix before the rest.
- **No other visible change.** The existing suite is the safety net.
- **Replace, don't layer**: when a helper becomes internal, its test cases move to the new module's interface and the old tests are deleted. Every PR lists old test to new test. No case is dropped.
- **Plain TypeScript cores, thin hooks**: as v8. No DOM test library.
- **Order**: the fix; then the Shared List card and the Meal Plan (the same recipe, in parallel); the lib client convention; the read state; then the event words and the route split together, since the split moves the words the new module owns.

### The Shared List card

- One `ListCard` module (`src/components/ListCard.tsx`) owns the heading and count, the pinned mark, the add row, the rows, the problem line and Clear with its focus rule. Its interface is the list, `size: 'card' | 'phone'`, `pinned`, and for the Wall `portrait`. It renders its own frame keyed on size (the Wall's `section` with the snap width and, in landscape, the scrolling items area with the overflow foot and the add-then-scroll-into-view; the phone's `PhoneCard`). `ItemRow` and `AddRow` already take `size`.
- The Wall's Lists screen and the phone's Lists tab draw it. The Home rail's list (a window of rows that fit, a hold on a crossed row, adds said on the status line) and the Settings items editor (order, not items) are not cards; they keep `useItems` as their interface.
- The count comes from `leftToGet` in both places; the Wall's own count goes.
- `tests/list-card.test.ts` today tests the rail's `rowsThatFit`; it becomes `home-list.test.ts`, and `list-card.test.ts` renders the card in both sizes.

### The Meal Plan

- **Meal Plan** enters the glossary: the Household's Meals for one week, Sunday to Saturday. The module takes its name.
- `src/lib/meal-plan.ts` (the core) and `src/lib/use-meal-plan.ts` (the hook) replace `use-meals.ts`. `meals.ts` keeps the row rules (`loadMeals`, `setMeal`, `withMeal`, `mealGrid`, `nextMeal`).
- `useMealPlan({ timezone, date, onNavigate, focus })` answers: the days and today; the pager as data (`previous`, `next`, `heading`, `words`, `limit`); the read state and `save`; the picked day and `pick` (today when the week holds it, else Sunday, following Household midnight; the Wall ignores it); and `cellFor(day, slot)` giving `{ meal, heard, sheet }`: the Meal or null, `undefined` while unknown; the words a screen reader hears; the sheet model.
- The Wall keeps its grid templates and inline paging buttons; the phone keeps its `Pager` part and day chips. Both draw cells from `cellFor`; neither computes words or the sheet model.

### Event words

- `supabase/functions/_shared/event-words.ts`, beside the Household clock, which the Wall imports already. Facts then words: `eventTime(occurrence, day)` gives `{ allDay, continues, endsHere, start, end, clocksRepeat }`; `timeWords(facts, form)` gives the sentence for `'pill' | 'block' | 'line' | 'sheet'`. The date words (`formatDate`, `formatDateWithYear`, `describeCell`) go with it as `dateWords`.
- The schedule pill, the day block, the month line, the details sheet, and push-notify's reminder ("At 8:30 AM") and morning summary (each line is the pill form) all ask it. `pillTime`, `blockTime`, `describeWhen`, `formatCompactClock`, the month line's inline rule and push-notify's `clockWords` go. Where the morning summary's all-day rule differs from the pill's, the pill's wins.
- The Native Event form's `clock()` makes an `<input type="time">` value, not words; it stays with the form.

### The Wall's routes

- `calendar-occurrences.ts` keeps the read: `Occurrence`, `loadOccurrences`, `dayOccurrences`, `wallHour`, `fiveDays`, `describePage`, `describeMonth`.
- The routes (`WallRoute`, `parseWallRoute`, `wallPath`, `mealsPath`, `mealsPageDate`, `holdsToday`, `wallDate`, `navigationRailDate`, `onCalendarScreen`) go to `src/lib/wall-routes.ts`, with `useWallRoute` from the Wall page as its thin hook. `tests/wall-routes.test.ts` already carries that name.
- The month cell's fitting (`cellLines`, `linesPerCell`, `isTightCell`, `monthMinRem`) goes to `src/lib/month-grid.ts`.
- The clock and date words go to event words.

### The read state

- The synced read says one `state: 'loading' | 'failed' | 'ready'`, and keeps `failed` as a flag beside it for "ready, but the last read failed" (the header's lost-connection line). It stays date-agnostic: the Routines-today hook maps its own `settled` onto the state it hands on (`settled ? read.state : 'loading'`; failed stays failed).
- One `ReadState` part (`<ReadState of="routines" read={read}>…</ReadState>`) draws the ladder: "Loading", or the alert with `couldNotLoad(of)`, or its children. It is the only place those words and the alert role are spelt. The five hand-drawn ladders go.
- The synced read gains `change(work, { failed, landed })` returning `'done' | 'failed' | 'busy'`: the card-write guard, then the write, then the read-back. The card write becomes internal to it (its own tests stay as the internal seam). All nine card writes in Settings go through `change`: the three `change()` copies go, and the six cards that never read back now do.

### The lib client

- Every lib that reaches Supabase takes the client as its first argument, as `calendar-accounts.ts`, `profiles.ts`, `routines.ts`, `meals.ts`, `shared-lists.ts` and `native-events.ts` do. `push.ts`, `device.ts` and `household-invites.ts` change; the browser-only parts of `push.ts` (the service worker, the permission, `pushSupport`) take no client.
- Their tests (`device-pairing`, `push-phone`, `household-invite-links`) stop importing lazily and call the libs with a client signed in as the principal, in the same PR. This does not reopen v8's out-of-scope "push client as a factory": the browser push stays untested.

### Schema

No migration.

## Testing Decisions

- As v8: a test drives a module through its interface and asserts what a caller or the family can observe. Seams: the database through the client as a real principal; the Edge Functions' outside HTTP, injected; the plain core of each stateful module.
- **Modules tested**:
  - List card: rendered in both sizes; the count's three states (unknown, failed, known); Clear's focus; "Nothing on this list." Cases from `lists-screen` and `phone-meals-lists` that reach the card move here.
  - Meal Plan: the week, the picked day across Household midnight, `cellFor`'s three states and words. Cases from `meals`, `phone-meals-lists` (`mealsPickedDay`, `slotRowName`, `sheetFor`) and `wall-screens` move onto the core.
  - Event words: every case from `day-view` (`blockTime`), `event-pill` and `month-cell` (times), `calendar-occurrences` (`describeWhen`, `clocksRepeat`, the formatters) and `push-notify-words` (`clockWords`, `morningBody` lines), on the one interface; the clocks-back and clocks-forward nights for Chicago, London and Auckland.
  - Routes and month grid: `wall-routes` and the month-fit cases from `calendar-occurrences`, unchanged in substance.
  - Read state: the state across first load, failure, success then failure; `change` for done, failed and busy with a read-back; the Routines mapping of `settled`.
  - Libs: pairing, invites and push rows through a signed-in client, as Device and as a second Household Account where RLS says no.
- Screens stay tested through static markup.

## Out of Scope

- Any new feature, words, colours or layout.
- The Home rail's list and the Settings items editor behind the list card.
- One `Pager` part for the Wall and the phone.
- The synced read learning about Household Dates.
- Moving the Native Event form's time value formatter.
- A DOM test library.
- The Edge Functions' shared frame (the repeated secret check, hand-written CORS): small, and not where change lands.

## Further Notes

- Each ticket is one PR into `owner/v10`, released to master as one PR, as v8 was. No hosted step beyond the deploy.
