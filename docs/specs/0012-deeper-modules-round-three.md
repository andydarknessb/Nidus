# Nidus v11: deeper modules, round three

Tracker: GitHub issue #219; its sub-issues #220 to #226 are the tickets. Vocabulary: [CONTEXT.md](../../CONTEXT.md) (Routine, Routine Completion, Routine Chart, Profile, Household Date, Native Event, Synced Event, Profile Filter, Calendar Account, Mirrored Calendar, Household Account). Decisions: [PLAN.md](../PLAN.md) ("v11: deeper modules, round three"). ADRs 0001 to 0003 stand; [ADR 0004](../adr/0004-the-household-facts-are-props-not-a-context.md) records the one refactor this round rejected. It continues [0008](0008-deeper-modules.md) and [0011](0011-deeper-screens.md): the same rulings (no visible change beyond the fix, replace don't layer, plain TypeScript cores with thin hooks, facts not sentences, the lib client first) apply to every ticket here.

## Problem Statement

v8 deepened six modules under the screens and v10 (spec 0011) deepened six more one layer up. An architecture review on 2026-10-12 of the finished v10 branch, seven read-only sweeps, found the next six places where one rule is written in two or more, and where the wiring between tested pure parts is itself untested:

- **The run budget for an iPhone feed.** Eight caps on a sync run (steps per run, per feed, per series, per day search; rows per feed and per event; RDATEs; the time limit) are checked in fifteen places across the feed expansion and the iCloud adapter, with "the run is out" spelt three ways. Eighteen commits in the week to 2026-10-12 each moved or added a check (#119, #127, #138, #139, #142, #216); the last fixed a check present in one spelling and missing from another.
- **The Routines today.** The Wall's chart and the phone's Routines tab compose the same column by hand, and the phone narrows the celebration on its own. "Finished" is spelt three ways, the part's visible list is concatenated three times, and the Routines lib has 63 exports mixing the row rules with today's chart, the Home tile, the tick problems and the celebration. The pure parts carry 250 cases; the wiring (the real toggle, the celebration dispatch, the settled gate, the shown part) carries none, and one test walks a rendered element tree to reach a tile's click.
- **The event sheets.** Four hosts each keep their own open state, seven props and a focus closure; what happens after a save is three different rules. The dialog frame (hold the background, keep the opener, the keys, the dialog element) is written three times with two scrim rules. The Native Event form's failure words have their own lifecycle, cleared on any keystroke and never re-announced. None of the host, the phone's day events, the Settings refocus or the dialog keys has a test.
- **The card change in Settings.** 0011 put the card write behind `change`, but five Settings cards still wrap it to clear their own problem words and build the same options literal, the same concept has three names, and four one-at-a-time guards live outside the card write. No test renders any card's wiring.
- **The month's cells.** The Wall's grid and the phone's each have a week-of-cells part under the same name, a beyond-range branch, pager words and a today disc (four copies at two sizes); and a screen reader hears a cell's name in a different order on the phone than on the Wall, though the phone's comment says they match.
- **Two reads outside the synced read.** 0008 ruled every client read goes through the synced read; the Profiles reader still runs its own loop with its own retry. The weather reads Open-Meteo through the global fetch, so its 57 tests never cross the network; the Edge Functions take their outside HTTP as an injected dependency, the client's one outside HTTP does not.

## Solution

Each becomes one module with a small interface at the place its callers already meet. The family sees one change:

- A phone's month cell is named for a screen reader in the Wall's words and the phone's order: the date's words, then "today" on today's. This fix ships first, on its own.

Everything else is invisible: no new words, colours, layouts or timings.

## User Stories

1. As a parent using a screen reader on the phone's month, I want each cell named as the Wall's cells and the week's chips are, so that today reads the same everywhere.
2. As a parent whose iPhone calendar has a heavy repeating series, I want the sync to stop at its budget the same way whichever cap it hits, so that one feed never takes the run from the others.
3. As the owner, I want every cap on a sync run owned by one module, so that the next "check before X" bug is found and fixed in one file.
4. As a child at the Wall, I want my Routine Chart column to tick, celebrate and say a problem exactly as the phone's card does, so that a fix to one is a fix to both.
5. As a parent on the phone's Routines tab, I want the card to celebrate the person shown when they finish, as it does today.
6. As a family member on Home, I want Up next and the people row's "2 of 5" to agree with the chart about who is finished.
7. As a family member at any screen, I want tapping an event, editing it, adding one and closing the sheet to return my focus to where I was, with one rule for what the screen does after a save.
8. As a family member typing into the Add event form, I want a tap on the scrim to leave my typing alone, as it does today, and a tap on the scrim of a details sheet to close it, as it does today.
9. As a parent who saves an event twice into the same failure, I want to hear the failure again the second time, as the Settings cards already say theirs.
10. As a parent in Settings, I want every card's problem line to clear, say and re-announce the same way, whether the card reads back or only writes.
11. As an agent building a Settings ticket, I want one name for "after the write landed" and one call for a change, so that I do not pick the wrong one.
12. As a family member on the Wall's month and the phone's, I want the same week of cells behind both grids, so that a beyond-range day and today look and read the same.
13. As a family member, I want the Wall's pager to keep the year and the phone's to drop it when current, exactly as today.
14. As the Wall, I want the Profiles read, retried and pruned by the same synced read as everything else, so that a lost connection behaves one way.
15. As a tester, I want the weather read through an injected fetch, so that the forecast's loop and words are tested against a recorded Open-Meteo answer.
16. As the owner, I want a run budget module, a Routine Chart module, an event sheet host, one card change, a month cells core and one client read, each testable through its interface, with every test of a helper that becomes internal carried over case by case.
17. As a family member, I want nothing else to change.

## Implementation Decisions

### Rulings (settled with the owner, 2026-10-12, three rounds, every recommendation taken)

- **The cell-name fix first, alone**: the phone's order wins (the words, then ", today"), as two of three places already have it and 0011's precedent is that the phone's rule wins. It lands on `owner/v10` before that branch is released, and is listed here as shipped ahead.
- **No other visible change.** The existing suite is the safety net.
- **Replace, don't layer**: when a helper becomes internal, its test cases move to the new module's interface and the old tests are deleted. Every PR lists old test to new test. No case is dropped.
- **Plain TypeScript cores, thin hooks**: as v8 and v10. No DOM test library.
- **Props, not a context**: the Household's facts keep reaching the screens as props ([ADR 0004](../adr/0004-the-household-facts-are-props-not-a-context.md)). The room-measuring hook (five ResizeObserver sites) was declined: no bug has landed there and it would be a seam with one real adapter.
- **Order**: the fix; then the run budget, the Routine Chart and the Month Cells in parallel (disjoint files); then the card change (it edits the synced read); then the event sheet host and the two reads in parallel. Seven tickets.

### The run budget

- One module, `RunBudget`, in the Edge Functions' shared folder, imported by the iCloud adapter without the feed expansion. The adapter makes one per run and hands it to the expansion, as today, but the expansion asks it instead of reading its fields. The bare budget record and every exported cap constant go.
- Its interface: the run-level question (`skip()`, `fresh` for the adapter's "untried" rule), a feed scope, a series scope within it, and from the scopes `step()`, `row()`, `rdate()`, `daySearch()`; and `admits(kind, estimatedSteps)` for the age limit (the walk estimates, the budget answers). The clock is injectable on the budget. `noFastForward` is the walk's and becomes an option of the expansion.
- A refused step throws the feed-too-large error from inside the budget; the walk's shape stays. "The feed is out" and "the run is out" cannot be spelt differently again because the scopes are the budget's.

### The Routine Chart

- **Routine Chart** enters the glossary (done): the Household's Routines for one Household Date, one column per Profile with a Routine that day, grouped by time of day; the Wall shows every column, a phone one picked column.
- A core (`routine-chart`) and a hook (`use-routine-chart`) replace the Routines-today hook and the chart half of the Routines lib. The hook takes the time zone and the Profiles and answers: the read state and date; `columns` and `columnFor(profile)` giving the profile, the shown part and `pickPart` with its hold, the routines as own, earlier and anytime, done, progress, finished, the problem words and the burst; `tap(routine, measured)` (the burst, the toggle, the write, the problem); `picked` and `pick` (today's first unfinished person, following Household midnight; the Wall ignores it); and `upNext` for the Home tile.
- The Routines lib keeps the schema types, the row calls, the schedule predicate, the progress count and the part-of-day clock. Everything about today's chart (parts, columns, pick, Up next, tick problems, celebration) moves into the core.
- Who reads it: the Wall's chart screen, the phone's Routines tab, Up next (the Home tile and the phone Home's row) and the schedule's people-strip words, all from the chart's interface. One read at the shell, as now. The phone's narrowed celebration is a rule and comes for free: bursts belong to a column and the phone asks for one.

### The event sheet host

- A core (`event-sheets`: the open state, the last-closed record, the 10 s refocus window) and a hook `useEventSheets({ timezone, profiles, refresh, focusPlace })` returning `open(occurrence)`, `add(date)` and the element the host renders. The six hosts (the Wall's schedule, the paged calendar, the phone's day events and Home, the Wall's Add button, the Settings events card) call two functions and render one element. The cluster sheet folds in as the host's third sheet and stops being a file.
- One after-save rule: the host refreshes the read it holds and returns focus to where the sheet was opened from. The Wall's "events added" version counter goes.
- One frame: the Sheet takes `canDismiss` (default always); the Native Event form passes its untouched rule; the Meals sheet renders through it. Two frame copies go.
- The form's own failure words go: it takes the card change's words (below) and clears them on edit, so a repeated identical failure is heard again.

### The card change

- `useChange(read?)` returns `change(place, work, words?)`, `problem(place)` and `busy`. It clears the place before the write, says the refusal, offline or given words on failure, re-announces a repeat, focuses on landing, and reads back when it has a read. The write-problem hook is deleted; the five wrappers go; the lone writes (Appearance, Weather, the time zone) and the Join page call it with no read.
- One name: the after-write callback is `landed` everywhere; `showing` goes, and the read's write takes `landed` too.

### The Month Cells

- The month-grid lib grows into the core: `monthCells(window, today, occurrences, pressed, form)` with form `lines` (the Wall) or `dots` (the phone) gives weeks of cells (date, name, isToday, beyond, lines or dots, open). The two grids draw; the duplicate week-of-cells part becomes one that both use. The dots keep their rule (only the pressed people, per the glossary's Profile Filter).
- The pager words become two forms of one function, as the event words have forms; the words do not change.
- One `TodayDisc(size)` part beside the other discs; four copies go.

### The two reads

- The Profiles reader goes onto the synced read with the filter's prune as its on-change. Its loop and retry go.
- The weather's fetchers take `fetch` as their first argument (the lib client convention applied to the client's one outside HTTP). The forecast hook keeps its own loop (the synced read is for the database and its change feed); its backoff and staleness rules stay.

### Schema

No migration.

## Testing Decisions

- As v8 and v10: a test drives a module through its interface and asserts what a caller or the family can observe. Seams: the database through the client as a real principal; the Edge Functions' outside HTTP, injected; the plain core of each stateful module; and now the client's one outside HTTP, injected the same way.
- **Modules tested**:
  - Run budget: the budget charged directly with a fake clock; every case from the expansion and whitelist tests that asserts on steps, time, "untried" or the too-large error moves here; the walk's cases keep a real budget; the sync's skip and fresh cases stay through the handler.
  - Routine Chart: the celebrate reducer, the part's follow and hold and pick, the after-tick problems, the picked person and first pick, the state mapping and the tap outcome all become cases on the core; the element-tree probe is replaced by a core case that calls `tap` and asserts the write and the burst. The chart and phone-routines renders stay static markup, fed from the real core.
  - Event sheets: open, close, the refocus window and the after-save rule on the core; the frame's dismiss rule in the sheet test.
  - Card change: done, failed, busy, the words' clear and re-announce, with and without a read-back.
  - Month cells: the month-cell, phone-month and month-grid cases meet on the core; the pager's two forms.
  - Reads: Profiles through the client as a Household Account and a Device; the forecast through a recorded Open-Meteo fake in the test support folder beside the Google and iCloud fakes, with fake timers for its loop.
- Screens stay tested through static markup.
- **Prior art**: the Meal Plan core and hook (0011), the synced read and card write tests (fake timers, a plain core), the calendar-sync and icloud-sync tests (handler with injected HTTP), the profiles test (real stack through test support).

## Out of Scope

- Any new feature, words, colours or layout.
- A Household context (ADR 0004) and a room-measuring hook.
- The Edge Functions' shared frame (0011 ruled it out; the sweep confirmed it is small and quiet).
- One fit rule: the five "how many fit" rules differ in kind.
- Making the Wall's and the phone's pager words the same.
- The forecast onto the synced read.
- A DOM test library.

## Further Notes

- Each ticket is one PR into `owner/v11`, released to master as one PR, as v8 and v10 were. `owner/v11` is cut from master after `owner/v10` is released. The fleet tenant's default branch points at the build branch while it is built and goes back to master after the release. The run budget touches the Edge Functions, so the release deploys calendar-sync.
- The review's report, with before and after diagrams, was a temp file; this spec and PLAN.md are its record.
