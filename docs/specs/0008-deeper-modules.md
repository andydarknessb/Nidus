# Nidus v8: deeper modules

Tracker: GitHub issue #144; its sub-issues are the tickets. Vocabulary: [CONTEXT.md](../../CONTEXT.md) (Household Date, Household Timezone, Profile Filter, Synced Event, Native Event, Calendar Account, Routine Completion, Shared List, Meal). Decisions: [PLAN.md](../PLAN.md) (v8 section). ADRs 0001 to 0003 stand; nothing here reopens them.

## Problem Statement

Seven versions shipped in two weeks, and the same few ideas were written again on each screen that needed them. Six behaviours are each spread across many places:

- The Household Date and the time of day on it: computed in the Routines module, imported by sixteen files, with a second, disagreeing implementation in the iPhone calendar sync.
- Reading data, listening for changes, and showing a tap before the server answers: five versions, four refresh timings.
- Which events are on which day, for whom: finished by hand in six views.
- Turning pages on the calendar and the Meals week: copied four times, focus rules included.
- Doing one thing at a time on a Settings card: copied five times, with the release written by hand at every early return.
- Mirroring a Calendar Account: two providers in one handler, each writing the account's row its own way.

The owner and the agents who build Nidus pay for this on every ticket. A rule has to be found in several places and changed in all of them. The bugs of the last week (focus at midnight, the six-week month at larger text, a feed's place in the sync order) landed in this copied wiring, which the tests do not reach; the tests check the pure helpers the wiring calls.

The family pays a little too:
- A floating-time iPhone event at 2:30 on the night the clocks go forward shows at 1:30.
- An iPhone calendar the sync simply did not reach in time says its last update failed.

## Solution

Each of the six behaviours becomes one deep module with a small interface, at the place where its callers already meet. The callers keep only what is theirs to draw. The family sees no change, apart from these:

- Times the clocks skip or repeat follow one rule everywhere (RFC 5545): a skipped time moves forward by the gap; a repeated time is the first one. This fix ships first, on its own.
- Every screen refreshes on the same timing: every 30 seconds, and 5 seconds after a read fails.
- A month on the calendar loads, or fails to load, as a whole.
- A calendar the sync did not reach this time says nothing new; its "last synced" age tells the truth.

## User Stories

1. As a parent in Chicago, I want an iPhone event at 2:30 on the morning the clocks go forward to show at 3:30, as Apple Calendar shows it, so that the Wall agrees with my phone.
2. As a parent in London, I want an iPhone event at 1:30 on the morning the clocks go back to show at the first 1:30, as the Wall's own events do, so that one time means one thing on the Wall.
3. As a parent adding a Native Event for a time the clocks skip, I want it to keep moving forward by the gap, as it does today.
4. As a family member at the Wall, I want Routines, lists, Meals and the calendar to catch up with another screen within 30 seconds even if a change notice is lost, so that every screen shows the same Household.
5. As a family member at the Wall, I want a screen whose read failed to try again within 5 seconds, so that a dropped connection mends quickly.
6. As a child ticking Routines while the tablet is offline, I want a tick that could not be saved to take back only itself, so that my other ticks stay where I put them, as today.
7. As a family member, I want a screen that already shows something to keep showing it when a later read fails, and to say it could not load only when it never has, as today.
8. As a family member, I want the calendar's month to show all its weeks once loaded, or one plain message if it could not load.
9. As a parent with Ava pressed on the people strip, I want an event for Ava and Ben to show and still name Ben, and the phone month's dots for that day to show only Ava, as today.
10. As a parent with Ava pressed, I want whole-Household events to show, as today.
11. As a parent, I want the morning summary on my phone to list exactly the events the Wall shows on that Household Date, so that both answer "what is on today" the same way.
12. As a family member who edits or deletes an event from its sheet, I want focus to land on the event, or on its day when the event has gone, on every calendar view, as it does on some today.
13. As a family member turning the calendar's or the Meals week's pages, on the Wall or the phone, I want the same paging limits, the same "as far back as it goes" sentence, and focus kept on the title when the page changes or midnight passes.
14. As a parent in Settings, I want a second press of Remove, Pair, Unpair, Invite, Add or Send a test while the first is working to do nothing, so that nothing happens twice.
15. As a parent in Settings, I want a card to come back to life after any failure, so that one error never leaves its buttons dead.
16. As a parent choosing calendars or whose calendar it is, I want quick choices to land in the order I made them, so that toggling twice ends where it started.
17. As a parent with an iPhone calendar whose link stopped working, I want Settings to keep telling me to turn on Public Calendar again and paste the new link.
18. As a parent with an iPhone calendar whose repeats were cut short, I want Settings to keep saying some repeating events cannot be shown in full.
19. As a parent with an iPhone calendar the sync did not reach this time, I want Settings to show "Connected" and its last-synced age, not that the last update failed.
20. As a parent, I want the Wall's "Last synced" badge to keep appearing when any calendar is more than an hour behind.
21. As the owner, I want the Household Date and the time of day on it to come from one module, used by the Wall, the phone and every Edge Function, so that a daylight-saving rule is decided once.
22. As the owner, I want one module to read data, listen for changes and show writes before the server answers, so that a fix to a stale-read race lands once for every screen.
23. As the owner, I want one module to answer "which events are on this Household Date, for whom", so that a wrong-day bug lives in one place.
24. As the owner, I want one module to own a page of days and where focus goes, so that the next focus bug is fixed for four screens at once.
25. As the owner, I want one write guard for Settings cards, so that a forgotten release cannot leave a card dead.
26. As the owner, I want each calendar provider behind one adapter that returns an outcome, so that the account's row is written by one piece of code.
27. As the owner, I want the sync and Settings to share facts, not sentences, so that rewording a message cannot break the screen.
28. As an agent building a ticket, I want each behaviour testable through one interface, against the real local stack where it reads data, so that the tests reach where the bugs land.
29. As an agent building a ticket, I want every test of a helper that becomes internal carried over case by case to the new interface, so that no covered behaviour is lost.
30. As a family member, I want nothing else to change: no new words, colours, layouts or timings beyond those above.

## Implementation Decisions

### Rulings (settled with the owner, 2026-10-07)

- **The DST rule first, alone**: the iPhone sync's floating-time conversion follows RFC 5545 (skipped: offset from before the gap; repeated: first). It ships to master as a bug fix before v8. Stored events put themselves right at the daily full read, so no backfill is needed.
- **No other visible change** beyond the Solution's list. The existing suite is the safety net.
- **Replace, don't layer**: when a helper becomes internal, its test cases move to the new module's interface and the old tests are deleted. Every PR lists old test to new test. No case is dropped.
- **Plain TypeScript cores, thin hooks**: every stateful module (synced read, paged view, card write) is a plain TypeScript core tested directly, with a React hook that only wires it to state and effects. No DOM test library is added. This follows the existing synced reader and status line.

### Household clock

- One module for Household-Timezone arithmetic, beside today's zoned-time helpers in the Edge Functions' shared folder (the Wall already imports from there). Free functions, timezone first, as now: the Household Date at an instant, its start, the instant of a time of day on it, adding days, and the page arithmetic the calendar and Meals use.
- The Household Date leaves the Routines module. The Native Event form's and the iPhone sync's conversions of a time of day become one, which follows the DST rule above. The Edge Functions' own next-day helpers go.
- One predicate, "is this event on this Household Date", lives here. The day-events module and push-notify's morning summary both use it. The calendar's database query stays only as a coarse first filter.

### Synced read

- One module merges the read loop (when to read: on start, on a change notice, on a backstop timer, on retry; change notices during a read become exactly one more read) and the synced reader (the screen's own writes win: no read lands over a write in flight; one read follows the last write).
- Timing for every read: 30 seconds after a read lands, 5 seconds after one fails.
- What is shown is the last read plus each pending change, applied in order. A change is a pure function of what is shown. A failed write drops only its own change; the read after the last write replaces everything. The per-module optimistic and rollback helpers go.
- It exposes the data, whether it has ever loaded, and `unread` (failed and never loaded). "Could not load the X. Check your connection." comes from one words function.
- Every client read uses it: Routines today, the Shared Lists and their items, Meals, the day-events module, the Household read behind the Wall, and the Settings cards' loading. The Calendars card's per-calendar queue becomes ordered pending changes.
- The Routine column's tap behaviour (finishing a Profile, the celebration's origin) becomes one module, shared by the Wall's column and the phone's card.

### Day events

- One module answers, for a span of Household Dates: the events on each date, ordered, after the Profile Filter; whether they have loaded; and `unread`. It waits for the Profiles. Views only draw.
- It reads the span in pages until a page comes back short, so a month is one read. The week-by-week reads in the Wall's and phone's month views, and their failure reporting, go.
- It carries both Profile Filter rules: an event that shows names all its people; the month's dots name only the pressed.
- One event-sheet host owns the open sheet, the re-read after an edit, and focus (the event, or its day when it is gone). It replaces the three hand-written copies.

### Paged view

- One module serves the Wall's and phone's calendars and both Meals week screens. Given the view, the date asked for and now, it answers today, the days of the page, previous and next, and whether either is beyond the limit. Its core decides where focus goes after a page turn or at midnight (the title, or nowhere); its hook moves the focus. Each screen passes its own "as far back as it goes" sentence.

### Card write

- One guard for one-shot actions on a Settings card (pair, unpair, remove, invite, add, send a test): a second press while busy does nothing; the guard releases on every exit, error included; `aria-disabled` is drawn, never `disabled`; focus goes where the card says afterwards. It works with the existing write-problem words.
- Choices that stack up are not one-shot actions; they go through the synced read's pending changes.
- Profiles, Routines, lists and items share one ordering helper (position, move, next order) instead of two copies.

### Provider adapters

- The calendar sync's run takes, from each provider, one adapter with one operation: sync this account, returning an outcome (synced, with whether repeats were cut short; failed, for the logs; needs to be connected again; or skipped). The run alone writes the account's row from the outcome, and orders the accounts.
- The Google adapter holds token minting and the events API, shared with calendar-connect's code exchange. The iCloud adapter holds the feed, its validators, the expansion and the run's work budget.
- **Skipped means untouched**: the budget check comes before the "tried at" stamp, so a calendar the run did not reach keeps its row and its place in line. Nothing writes "was not read this time" any more.
- **Facts, not sentences**: a new `truncated` flag on the Calendar Account says repeats were cut short. `last_error` is for logs only: never shown, never compared. The "link no longer works" words key on status and provider. The sentence copies in the sync and the client, and the test that holds them together, go.
- The Edge Functions share one small module for the secret check, JSON and CORS answers, and finding the caller's Household Account from the bearer token.

### Schema

```
calendar_accounts    + truncated boolean not null default false
```

One migration. It also clears the two stored sentences that `truncated` and the untouched-skip replace.

## Testing Decisions

- A good test drives a module through its interface and asserts what a caller or the family can observe: the dates and events returned, what a screen would show, the row a sync leaves. It never asserts internal state or the order of internal calls, and it survives a refactor of the implementation.
- **Seams** (two exist; one is added):
  - The database, as now: the Supabase JS client against the local stack, acting as a real principal (Household Account, Device, anonymous). Never mocked.
  - The outside HTTP an Edge Function makes, as now: injected into the function. The calendar sync stays tested through its handler with injected `fetch`. Each provider gets one shared fake in test support, replacing the hand-built URL-sniffing fakes in five test files.
  - New: the plain TypeScript core of each stateful module, below React. The synced read is tested with fake timers and a `load` that is either a stub or a real query against the stack.
- **Modules tested**:
  - Household clock: the DST cases already written for Chicago, London and Auckland move onto it, plus Santiago (no midnight) and the RFC 5545 skipped and repeated cases from the comparison run (26 quarter-hours across 8 zones in 2026).
  - Synced read: change notices during a read, writes in flight, the backstop and retry timing, `unread`, and two pending changes where the first fails.
  - Day events: a real-stack test arranges a Household with Profiles and events (a multi-day event, a DST day, more than 1000 occurrences in a month) and asserts the events by date and the filter rules.
  - Paged view: limits and focus decisions with a fixed now, including midnight.
  - Card write: double press, release after a throw, focus after.
  - Calendar sync: one outcome per case through the handler: synced, cut short (`truncated` set), link gone, failed, skipped (row unchanged).
- **Prior art**: synced-reader and read-loop tests (fake timers), status-line tests (a plain core), calendar-paging and calendar-days tests (pure date cases), calendar-sync and icloud-sync tests (handler with injected HTTP), calendar-occurrences and native-events tests (real stack through test support).
- Screens stay tested through static markup, as now.

## Out of Scope

- Any new feature, words, colours or layout.
- Splitting the page files by concept (Wall, phone, admin) beyond the Routine column's shared tap behaviour.
- An event-draft module for the Native Event form.
- One module that decodes database error codes for the client.
- Making the push client a factory so turning notifications on can be tested through to saving.
- Renaming the Google-named columns that hold iCloud data.
- A DOM test library.

## Further Notes

- Order: the DST fix to master; then the Household clock; the synced read; day events and the paged view in parallel; the card write; the provider adapters. Each ticket is one PR into `owner/v8`, released to master as one PR, as v7 was.
- The migration needs the hosted push at release, as every version's has.
