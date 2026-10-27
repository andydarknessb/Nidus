# Nidus v14: deeper modules, round five

Tracker: GitHub issue #262; its sub-issues #263 and #264 are the tickets. Vocabulary: [CONTEXT.md](../../CONTEXT.md) (Native Event, Repeat, Occurrence, Routine, Routine Chart, Shared List, Pinned List, Profile). Decisions: [PLAN.md](../PLAN.md) ("v14: deeper modules, round five"). It continues [0008](0008-deeper-modules.md), [0011](0011-deeper-screens.md), [0012](0012-deeper-modules-round-three.md) and [0014](0014-deeper-modules-round-four.md): the same rulings (no visible change, replace don't layer, plain TypeScript cores with thin hooks, props not a context) apply to both tickets here.

## Problem Statement

An architecture review on 2026-10-27 walked master after v13, in four read-only sweeps, and looked hardest at what v12 changed. Two places still hold a rule in a screen, where only rendered markup reaches it.

- **The Native Event form.** The sheet that adds and edits a Native Event is the only caller of 17 of the Native Event module's 26 exports, and it decides the rest itself: the shape a Repeat takes when its kind is chosen (the number and the end kept, a week starting with the form's own day), the Everyone rule for "Who is it for?", whether Save writes or first asks "this one, or every one?", and which of four writes each answer means. It holds nine hooks, two of them refs that mirror its own state. v12 added the Repeats row, the question and the time sheet after v8 had ruled "an event-draft module for the Native Event form" out of scope, and those are the decisions the tests reach only through markup.
- **The hold on Home.** Up next and the Pinned List card each keep a row that was just tapped where it is, in the done look, for four seconds, so a second tap can take it back; and each hands the keyboard's focus to the link in its heading when such a row goes. The focus hand-off is copied line for line. Up next's hold is a rule in the Routine Chart's core with its timer in the chart's hook; the Pinned List card's is a rule in the Shared List module with its timer inline in the card, untested. The Shared List module takes its four seconds from the Routine Chart's module, and the two cards keep "what was tapped here and when" in two shapes.

## Solution

Two modules, each with a small interface where its callers already meet: the event draft, and the hold. Nothing the family sees changes: no words, colours, layouts or timings. The suite is the safety net, and every test of a helper that becomes internal moves to the new module's interface, case by case.

## User Stories

1. As a parent adding an event, I want the form to open on the same day and time it does today (the next whole hour for today, 9:00 AM for another day), so that nothing I am used to moves.
2. As a parent picking another day, I want the times I set to stay with the event, and the times I did not set to follow the day, as they do today.
3. As a parent choosing how an event repeats, I want the number and the end I chose to stay when I change from weeks to months, and a week to start with the event's own day pressed, as it does today.
4. As a parent choosing who an event is for, I want pressing a person to let Everyone go, and pressing Everyone to let every person go, as it does today.
5. As a parent saving an event that repeats, I want to be asked "this one, or every one?" before anything is written, as I am today.
6. As a parent answering "this one", I want only that day changed or deleted, and the day never to come back, as today.
7. As a parent answering "every one", I want every day of the Repeat changed, and the first day kept on a day the Repeat lands on, as today.
8. As a parent deleting an event that does not repeat, I want one "Delete" question, as today.
9. As a parent whose save did not go through, I want the question taken away and the reason said at the form's foot, as today.
10. As a parent who has typed nothing, I want a tap outside the sheet to close it, and once I have typed, only Close, Cancel and Escape to, as today.
11. As a parent setting a time on the time sheet, I want an end that is not after the start refused in the same words, as today.
12. As a family member ticking a Routine in Up next, I want the tile to stay in the done look for four seconds, and a second tap in that time to take the tick back, as today.
13. As a family member crossing off an item on the Pinned List card, I want the row to stay for four seconds, and a second tap in that time to put it back, as today.
14. As a person using a keyboard, I want the focus to go to the link in the card's heading when the row I was on leaves, on both cards, as today.
15. As a tester, I want the form's rules driven through one draft as plain calls, so that a fix to how an event repeats or saves is tested in one place without rendering the sheet.
16. As a tester, I want "what a write means" checked against the local database through one plan runner, so that "this one" and "every one" are tested where they are written.
17. As a tester, I want the four-second hold tested once, so that both cards keep the same rule.
18. As an agent changing the event form next, I want the form's rules in one module and the sheet to be markup and wiring, so that a change lands in one file.
19. As a family member, I want nothing else to change.

## Implementation Decisions

### Rulings (settled with the owner, 2026-10-27, two rounds, every recommendation taken)

- **No visible change.** No fix rides along. The existing suite is the safety net.
- **Replace, don't layer**: a helper that becomes internal takes its tests with it; every PR lists old test to new test, and no case is dropped.
- **Plain TypeScript cores, thin hooks**, as v8, v10, v11 and v13. No DOM test library; no mocked database.
- **Props, not a context**: [ADR 0004](../adr/0004-the-household-facts-are-props-not-a-context.md) stands. The change at a place stays as [ADR 0006](../adr/0006-one-change.md) says: the draft never holds a write's problem.
- **v8's out-of-scope ruling on an event-draft module is reopened.** It was made before Repeats; the decisions it would have held are the ones v12 added. The ruling is recorded here, not in an ADR: the module is internal and reversible.
- **Two tickets, in parallel**, on disjoint files: #263 the event draft, #264 the hold.
- **The new nouns live here, not in `CONTEXT.md`.** "Event draft", "plan" and "hold" are not household facts.
- **Dropped after the review**: one rule for the Routines left on a Household Date, shared by the Routine Chart and the push (what the two share is one line, and their Profile orders differ in kind: the client's by position, the push's in SQL); and one description per Calendar Account provider on the client (the branches choose different contents, a Google account's reconnect and many calendars against an iPhone calendar's one, so a table would leave the card branching on its markup).

### 1. The event draft

- **The event draft** is a plain core: an immutable value and pure transitions over it, with no screen and no database. It holds the form (title, day, all day, starts, ends, location, notes, people, Repeat), the form as it opened, whether the times stay when the day changes, whether "Another day" is chosen, and the question being asked (none, delete, or save).
- It opens from a Household date (a new Native Event, at the opening times) or from an Occurrence (an edit, whose times always stay).
- Its interface, by what a caller asks:
  - **Moves**: set a field, pick a day, choose Another day, choose a Repeat's kind (or none), change the Repeat's number, days or end, press a person, press Everyone. A move that changes nothing returns the same draft, which is how a caller tells a real change.
  - **Set a time** from the time sheet's Done: Starts takes Ends with it; an Ends not after Starts is refused with the time sheet's words. The time setters that today live with the time sheet's parsing become the draft's own.
  - **Submit**: a problem in the form's words; or, for an Occurrence of a Repeat, the draft now asking "save"; or a plan.
  - **Ask to delete**, **go back** (the question goes), **a write that failed** (the question goes).
  - **Answer** "one" or "every": a plan. For an event that does not repeat, the one Delete button answers "every".
  - **Untouched**: whether nothing has been typed or changed since it opened, which the sheet's scrim asks.
  - **The day row**: the day choices and whether Another day is chosen.
- **A plan** says what is written, named for the write: `add`, `save`, `save-one`, `save-every`, `skip`, `delete`. It carries what its write needs and nothing the screen holds.
- **The plan runner** lives with the Native Event module's database half: it takes the client and a plan, writes it (a save, a save of this one with the day skipped, a save of every one moved by the day's change, a skipped day, a delete), and returns the sentence the status line says. The Native Event module keeps the runner, `saveNativeEvent` (other tests write their fixtures with it), the upcoming read, the Repeat's words, the time field's words and the types. The form's helpers that only the sheet called become the draft's, and are no longer exported.
- **The thin hook** keeps the current draft (the "form as the last change left it" ref moves inside it) and hands the sheet what it needs at once: a move says whether it changed anything, so the sheet clears the event's problem only then; setting a time returns the refusal words or nothing; submit and answer return the problem or the plan. The hook does not write.
- **The sheet** keeps which time sheet is open, the two field refs, focus, and its wiring: it runs a plan through the one change at its place, clears the Profile Filter, says the sentence and calls `onSaved` when the write lands, and tells the draft when it failed.

### 2. The hold

- **The hold** is a plain core: the four seconds, the one shape for "what was tapped here and when" (a read-only map from id to the time), whether an id is held at a time, and when the first hold that has not ended ends. A tap whose time is later than the `now` a card last looked at counts as held, so a tap does not have to move the clock.
- The Routine Chart's Up next tiles and the Shared List module's Home rows each ask whether a row is held, and keep their own other condition (still ticked, still crossed off). The Shared List module no longer takes the four seconds from the Routine Chart's module.
- **The hold clock** is a thin hook: given the holds, it returns `now`, renewed when the first hold ends. The Routine Chart's hook and the Pinned List card both use it, in place of their two timers. `now` leaves the Routine Chart's state; the chart's hook hands the clock's `now` to Up next, and a tap no longer sets it, in the chart or in the card.
- **The focus hand-off** is a thin hook: given the card and its heading link, it returns the ref a row is drawn with, and when a row goes while it has the keyboard's focus, the focus goes to the link. Up next and the Pinned List card both use it, in place of their two copies.
- The two hooks live together, beside the core, as the codebase pairs every core with its hook.

### Schema

No migration.

## Testing Decisions

- A good test drives a module through its interface and asserts what a caller sees: the draft's answer to a move, a submit or an answer; what the database holds after a plan runs; whether a row is held. A test that has to change when the module's insides change is testing past its interface.
- **The event draft**: a new test file drives it as plain calls. The cases of the form's helpers move there case by case: opening times, moving to a day, untouched, the form to a write's input (from the event form's tests and the sheet's tests), and the time setters (from the time picker's tests). New cases pin what is today reached only through markup: choosing a Repeat's kind keeps its number and end, and a week starts with the form's day pressed; pressing a person lets Everyone go and pressing Everyone lets every person go; a submit on an Occurrence of a Repeat asks before it plans; the Delete of an event that does not repeat plans a delete; a write that failed takes the question away; a move that changes nothing returns the same draft. Prior art: the form row's tests (pure transitions over a row), the event form's tests.
- **The plan runner**: the Native Event tests' cases for this one, every one, a skipped day and a delete run through the runner against the local stack, as the principals they use today. Prior art: the Native Event tests and the Repeat expansion tests.
- **The sheet**: its markup cases stay where they are (the event form's and the sheet's tests, rendered to static markup).
- **The hold**: a new test file drives the core: when the first hold ends (the cases move from the Routine Chart's tests), held and not held at the edge of the four seconds, a tap later than `now` held. The Home rows' cases stay in the Home list's tests and take the four seconds from the hold. The two hooks are thin and untested, as there is no DOM test library; each is written once.
- `pnpm typecheck`, `pnpm lint` and the suite pass on each ticket.

## Out of Scope

- Any new feature, words, colours, layout or timing.
- What removing a Google account and removing an iPhone calendar say, and where (a separate issue, since it changes what the family sees).
- One rule for the Routines left on a Household Date, shared with the push; one description per Calendar Account provider on the client (dropped, with reasons, in the rulings).
- The time sheet's drums and typed field, beyond the two time setters that move to the draft.
- The Repeat's expansion, which stays the database's ([ADR 0005](../adr/0005-native-events-repeat-expanded-by-the-database.md)).
- Event details and the Settings list of upcoming Native Events, which only read.
- A Household context (ADR 0004); splitting the change's guard or a page-wide failure string (ADR 0006); the Edge Functions' shared frame; a DOM test library.

## Further Notes

- Each ticket is one PR into `owner/v14`, cut from master, released to master as one PR, as v11 and v13 were. Nothing under `supabase/` changes, so the release has no migration and no Edge Function deploy.
- The review's report, with before and after diagrams, was a temp file; this spec and PLAN.md are its record.
