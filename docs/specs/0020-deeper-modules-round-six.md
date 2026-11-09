# Nidus v19: deeper modules, round six

Tracker: GitHub issue #300; its sub-issues #301 to #306 are the six tickets. Vocabulary: [CONTEXT.md](../../CONTEXT.md) (Household, Household Account, Device, Profile, Shared List, Pinned List, Routine, Native Event, Occurrence, Household Date, Household Timezone, Calendar Account, Synced Event, Usual). Decisions: [PLAN.md](../PLAN.md) ("v19: deeper modules, round six"). It continues [0008](0008-deeper-modules.md), [0011](0011-deeper-screens.md), [0012](0012-deeper-modules-round-three.md), [0014](0014-deeper-modules-round-four.md) and [0015](0015-deeper-modules-round-five.md): the same rulings (replace don't layer, plain TypeScript cores with thin hooks, props not a context) apply to every ticket here. Unlike rounds four and five, it carries six named fixes.

## Problem Statement

An architecture review on 2026-11-09 walked master during v18, in three read-only sweeps, and looked hardest at what had changed most. The calendar and Routine cores came back deep and well tested. Six places did not: one rule is written in two or more places, or the wiring between tested parts is reached by no test. Two of them already tell the family the wrong thing.

- **A Shared List's card.** The read of a list's items hands back thirteen members, and each of its four callers (the Lists card, the phone's chip, Home's card and the Settings editor) works out the count and whether the list is empty for itself. Home's card works them out differently: after a failed first read it says "Nothing left to get" beside its alert and names itself "0 left". A write that did not go through is said two ways inside the one hook, a string of its own beside the change's places, which makes the hook a second caller of the words [ADR 0006](../adr/0006-one-change.md) gives one. No test reaches the hook's writes: the tests retype them by hand. The shopper's ask (#294) adds a third way of tracking a write in progress.
- **Settings and the Household.** Settings reads the Household once and copies it into a form. A page left open puts the old time zone back when someone saves a new name, and every Native Event moves with it. The Notifications card reads the Profiles and the Pinned List's name once, so "Whose events?" stays missing after the first person is added, and a deleted person's chip stays. Spec 0008 ruled that every client read goes through the synced read, and these are the last three that do not.
- **The question before something goes.** Six removals hand-wire ask, cancel, confirm and focus, in three state shapes, with three rules for what is cleared and two ways of sending focus back. No test reaches the steps. Routines and Shared Lists skip the shared question altogether, so Escape does nothing there.
- **Send to Target.** Which press marks a list sent is decided inside the sheet. Two helpers were pulled out for tests, each with one caller, and the test named for the sheets' paths never crosses a sheet or the writes. The pull request that built it (#296) took three rounds of review fixes, all in that wiring.
- **The Household clock's SQL half.** The rule for a time that happens twice is written three times in SQL. The Household clock says nothing else computes it, and nothing checks that the two agree. The SQL looks only one hour back, where the clock handles a change of any size.
- **A provider's event row.** Google's adapter and the iPhone calendar's each build the row by hand, with the same default title, caps and checks on the instants, and the merge SQL recognises that default title by its words (#247).

## Solution

Six changes, each at the place its callers already meet. What the family sees changes only in the six named fixes:

1. Home's card stops saying what nobody knows.
2. Settings shows the Household as it is now and saves only what was edited.
3. The question before deleting a Shared List or archiving a Routine is the same question as everywhere else in Settings.
4. Opening or cancelling a question or a form takes away what was said on that card.
5. A retry that fails again on a list is announced again.
6. A time that happens twice is the first of the two in a zone whose clocks go back half an hour.

Everything else stays as it is, and the suite is the safety net. Every test of a helper that becomes internal moves to the new module's interface, case by case.

## User Stories

1. As a family member looking at Home when the list could not be read, I want to be told it could not load and nothing else, so that I am never told there is nothing left to get when nobody knows.
2. As a person using a screen reader on Home, I want the Pinned List's card named "Groceries, 3 to get", as every other list card is, so that one list has one name.
3. As a person using a screen reader, I want a card whose count is not known named by the list's name alone, so that I never hear "0 left" of a list nobody read.
4. As a family member whose cross-off on Home did not save, I want the count left unsaid until the next write lands, as on the Lists card, so that a number on the screen is never one that may be wrong.
5. As a family member adding an item on any card, I want it to show at once and the field to empty, as today, so that I can add the next one straight away.
6. As a family member crossing off or clearing items, I want them to change at once and only the one that failed to come back, as today.
7. As a parent reordering a list on the phone, I want the order put back and the same words when it did not save, as today.
8. As a person using a screen reader, I want a retry that fails again to be announced again, so that I know it did not work the second time.
9. As a family member switching between lists, I want a failure said on one list never to show on another, as today.
10. As a family member on the phone, I want each list's chip to show its count, and nothing when the count is not known, as today.
11. As a family member who has sent a list to Target, I want the sent line and Got it on the list card and on Home to read as they do today.
12. As a family member pressing Suggest from meals, I want a second press while it is asking to do nothing, so that one press is one run.
13. As a family member waiting on Suggest from meals, I want to go on adding and dismissing suggestions while it asks, as today.
14. As a parent with Settings left open on a phone, I want the Household's name and time zone to show what the Household holds now until I edit them, so that I am not looking at an old time zone.
15. As a parent fixing the Household's name while another phone changed the time zone, I want my Save to send only the name, so that the time zone stays and the Native Events do not move.
16. As a parent halfway through choosing a time zone, I want what I chose to stay while another phone changes the name, so that my work is not taken away.
17. As a parent pressing Save with nothing edited, I want it to say Saved, as today.
18. As a parent whose Save did not go through, I want my edits kept and the reason said at the form, as today.
19. As a parent who has just added the first person on the Settings page, I want "Whose events?" to appear on the Notifications card with no reload.
20. As a parent who has deleted a person, I want their chip gone from "Whose events?" with no reload.
21. As a parent who renamed the Pinned List, I want the notification switch to name it with no reload.
22. As a parent looking at Settings after someone renamed the Household, I want the top bar to say the new name with no reload.
23. As a new Household Account signing in for the first time, I want the Household to be made, as today.
24. As a parent whose connection drops on Settings, I want what is on the screen to stay, and the same words if the Household could never be read, as today.
25. As a parent changing how the Wall looks or where its weather is for, I want the card to show what I saved with no flicker back to the old value.
26. As a parent deleting a Shared List, I want to be asked "Delete Groceries?" and told "Its items go with it, and it can't be brought back." before it goes, so that I know what I am agreeing to.
27. As a parent archiving a Routine, I want to be asked "Archive Brush teeth, morning?" and told "It comes off Sam's chart and can't be brought back. Days already ticked are kept." before it goes.
28. As a person using a keyboard on those two questions, I want focus on the safe answer and Escape to mean it, as on every other question in Settings.
29. As a parent whose delete or archive did not go through, I want the question to stay and the reason under its buttons, so that I can try again where I am.
30. As a parent, while a delete or archive is on its way, I want both buttons to do nothing, so that I am never told it was kept when it was not.
31. As a person using a keyboard who answers "Keep it" or "Cancel", I want focus back on the button that asked, on all six questions.
32. As a person using a keyboard when something has gone, I want focus on the next sensible control (the next list's title, New list, that person's Routines, the form that adds), as today.
33. As a parent, I want opening or cancelling any question or form to take away what was said elsewhere on that card, whichever card it is, so that old words do not sit beside a new action.
34. As a parent, I want the words on the tablet, sign-in, calendar and person questions to stay as they are.
35. As a family member sending a list to Target, I want Open in ChatGPT, a Share that went through and a Copy that worked to mark it sent, as today.
36. As a family member who closes the phone's share sheet without sharing, I want nothing marked and nothing said, as today.
37. As a family member whose Share or Copy failed, I want the same words, and nothing marked, as today.
38. As a family member pressing twice, I want the second press to do nothing while a mark or a share is on its way, as today.
39. As a family member with a very long list, I want no Open button when the link would be too long, as today.
40. As a person in a Household whose clocks go back half an hour, I want an event at a time that happens twice to be on the first of the two, as the calendar says everywhere else.
41. As a parent, I want Repeats and a change of time zone to land on the same days and clock times as today.
42. As a family member, I want an event with no title from any calendar to read "(No title)", and two of them at the same time to stay two, as today.
43. As a tester, I want the list card's writes driven through one interface against the local database as a Household Account and as a Device, so that a wrong write fails a test.
44. As a tester, I want the form row to cover the question's open, cancel and landing, so that a fix to that lifecycle is tested in one place.
45. As a tester, I want every press of Send to Target driven with a fake share and a fake clipboard, so that the decisions are tested without a screen.
46. As a tester, I want one table of cases run through the Household clock and the SQL, so that the two cannot drift.
47. As a tester, I want an untitled event written through each calendar provider and read back as its own Occurrence, so that the chain is tested end to end.
48. As an agent changing the list card next, I want the count, what is waiting and the writes in one module, so that a change lands in one place.
49. As an agent adding another removal, I want to name its words and its write and nothing else, so that it asks like every other.
50. As an agent changing the Repeat's expansion, I want to call the rule by name and not restate it.
51. As a family member, I want nothing else to change.

## Implementation Decisions

### Rulings (settled with the owner, 2026-11-09, two rounds, every recommendation taken)

- **Six named fixes, no other visible change.** They are the six in the Solution.
- **Replace, don't layer**: a helper that becomes internal takes its tests with it; every PR lists old test to new test, and no case is dropped.
- **Plain TypeScript cores, thin hooks**, as v8, v10, v11, v13 and v14. No DOM test library; no mocked database.
- **Props, not a context**: [ADR 0004](../adr/0004-the-household-facts-are-props-not-a-context.md) stands.
- **One change at a place**: [ADR 0006](../adr/0006-one-change.md) stands, and this round brings the list card's failed writes and the shopper's ask onto it.
- **After v18.** The build branch is cut from master once #294 and #295 have merged. #295 overlaps the card only where the Usuals reach the message, so holding it back would buy little.
- **The new nouns live here, not in `CONTEXT.md`.** "List card" and "the send" are not household facts.
- **No ADR.** Everything here is internal and reversible, and the rulings are recorded here and in PLAN.md.
- **Dropped after the review**:
  - One description per Wall screen. A table would move the rule without removing it: each branch passes different props, no new screen is planned, and the shell has been quiet since 14 October. One piece stays: the phone's screen chooser names its return type, so a route left out of it fails the typecheck.
  - One day list on the phone, the Today card drawn by the picked day's list. It saves about twenty lines and adds heading, padding and focus props.
  - Meal slot words on the server (four stable strings), one rule for choosing people (one-line toggles, each right where it sits), a plain core for the keyboard hold behind Home's layout (one caller, quiet since 8 October), a plain core for the Wall's gate (one caller, and the gain is test locality only), and one sheet title row and one nightly prune (no drift so far, and tests hold the prune).
  - The stale-sync mark keeps its own loop: it already reads again every minute and on a change.

### 1. The list card

- **The list card** is a plain core in the Routine Chart's shape: one function over facts and effects, with no screen. The facts are the list, what was read and where the read is. The effects are the client, the synced read's write and the change's members.
- It answers: the items; how many are left to get, or nothing while that is not known (until the items are read, and whenever the last read or write failed); how many are crossed off; the items to get; the items waiting for Got it and when they went; the words for the card's foot, with a count that changes when a failure is said again; the words for the two sheets and how to forget them; and whether a write is on its way. Its writes are add, cross off, clear, move, mark sent and got.
- A card asks whether the count is known; the separate "loaded" flag leaves the interface. "Nothing on this list" and "Nothing left to get" are said only when the count is known and there are no rows to draw (Home's rows include one held for its four seconds).
- **How a failed write is said.** Add, cross off, clear and move keep showing first through the synced read's write, because the change queues and does not show first. A failure goes through the change's own fail and say, at one place per list, and a write that lands takes it away. The hook's own string and its failure-words hook go. Move keeps its own sentence, said at that place. Send and Got it keep their places.
- **Home's card** takes its count from the module and its name from the rule the other cards use.
- **The thin hook** reads through the synced read and hands its members as effects, so the four callers keep one call.
- The add row, the item row and the pin mark move beside the card, and the card stops importing from the Settings page that imports it.
- Got it's two blocks stay in their cards, because their words and sizes differ. The suggestions' hook stays a hook: it is on the change already, and a core would only pass calls through.
- **The shopper's ask** runs on a change of its own, apart from the suggestions', so an ask of up to two minutes never blocks adding or dismissing. It names no place, since an answer's words are the shopper's own. What it asks and what it says do not change. A second ask after the card unmounts can still run, and the ten runs per Household Date ([ADR 0007](../adr/0007-claude-suggests-the-assistant-shops.md)) are the backstop.

### 2. Settings follows the Household

- **The Administration shell** makes sure of the Household once per signed-in Household Account, as today, then follows it through the synced read, from inside the change feed's provider so that a change is heard at once. It hands the current Household to every page. A first read that fails says today's sentence; a later failure keeps what is shown.
- **The Household form** is a draft over the read: a field shows the Household's value until someone edits it. Save sends only the fields edited. With none edited it writes nothing and says Saved. A save that lands forgets the draft, and one that fails keeps it. The time zone's trigger fires only when the zone differs, so a Save that leaves the zone out moves no Native Event.
- **The write** takes a name, a time zone or both.
- **Every card that writes the Household** (the form, how the Wall looks, the weather) reads back through the followed read before its write is over, so the saved callback goes and nothing flickers to the old value.
- **The Notifications card** reads the Profiles and the Pinned List's name through a synced read of their own, apart from the card's read of the phone's notifications. A failure there stays silent, as today: no "Whose events?", and nothing dropped from the saved choice.

### 3. The question before something goes

- **The removal question is a form row with no name.** There is no new module.
- The form row gains two things. Opening or closing a row forgets everything said on its card, by the change's documented rule (opening or closing a form takes away what another one said). This applies to every row that opens and closes, and the by-hand clears beside them go. And a row can close after a removal has landed without sending focus to the control that asked, which has gone; the landing says where focus goes.
- Six removals use it: a Device, a Household Account, a Calendar Account, a Profile, a Routine and a Shared List. The three state shapes go. A Device's and a Household Account's rows keep which row is expanded as state of their own.
- **Routines and Shared Lists ask through the shared question**, with these words. The buttons keep today's words, and the Pinned List gets the same words as any list.

| | Routine | Shared List |
|---|---|---|
| Title | Archive {title and part of day}? | Delete {name}? |
| Words | It comes off {person}'s chart and can't be brought back. Days already ticked are kept. | Its items go with it, and it can't be brought back. |
| Safe button | Keep it | Keep it |
| Doing button | Archive {title and part of day} | Delete {name} and its items |

- The question stays open until the write lands, and a failure is said under its buttons, at today's places. Where focus goes once something has gone is as today.
- A removal that #295 adds to the Usuals card joins the same lifecycle.

### 4. The send

- **The send** is a plain core for one sheet. It takes the message, the phone's share and copy as adapters, the mark-sent write and whether a write is on its way. Two adapters make the seam real: the browser's in the sheet and a fake in tests. A phone with no share sheet has no share adapter.
- It decides what each press means. Open marks the list sent, unless a write is on its way. A share that resolves marks it; one the person closed marks nothing and says nothing; any other failure marks nothing and says so. A copy that worked marks it and says so; one that failed says so and marks nothing. A press while a mark is on its way or the share sheet is open does nothing.
- It calls the phone's share in the same turn as the press, because the browser allows a share only from a press.
- The sheet is markup and a thin hook. The helper that worded a share's end becomes internal. The message core stays as it is.
- The Got it sheet stays as it is: one filter and a close, with nothing to hide.

### 5. The clocks-repeat rule

- **One SQL function names the rule**: the instant a wall clock reads in a zone. A time the clocks skip moves forward by the gap, and a time that happens twice is the first of the two, when the clocks go back by an hour or by half an hour.
- The Repeat's expansion and the re-anchoring call it, and both keep their signatures. It runs as whoever expands a Repeat, so it takes the expansion's grants: Household Accounts and Devices may execute it, anonymous sessions may not.
- The one-line Household Date stays inline: one copy sits in a row-level policy, where a function would run per row.
- The Household clock's header names the function as its other half.

### 6. A provider's event row

- **The row's module**, which already holds the row's type and caps, builds the row from facts: the key, the title, the notes, the place, the two instants and all day. It applies the default title, the caps and the ISO instants, and refuses a bad instant or an end before the start.
- Both adapters hand over facts, and everything else about each provider stays in its adapter.
- The default title's words are named once in TypeScript. The merge SQL goes on recognising them by those words, and the module says so.
- The Google-named key column keeps its name, as v8 ruled.

### Tickets (each one pull request into `owner/v19`, in this order)

1. **One read of a Shared List** (#301), with the shopper's ask, Home's card and the phone's screen chooser's return type. First, because tickets 3 and 4 share its files.
2. **Settings follows the Household** (#302). Runs alongside.
3. **The question before something goes** (#303). After ticket 1.
4. **Sending a list to Target** (#304). After ticket 1.
5. **The clocks-repeat rule, named once** (#305). Runs alongside.
6. **A provider's event row** (#306). Runs alongside.

Every ticket is blocked by #295.

### Schema

One migration, in ticket 5: the new function, and the Repeat's expansion and the re-anchoring redefined to call it. No table changes.

### Deploy

Before the release merges: push the migration and deploy `calendar-sync`. The hosted steps are Cory's.

## Testing Decisions

- A good test drives a module through its interface and asserts what a caller sees: what the card answers, what the database holds after a write, what a press came to. A test that has to change when the module's insides change is testing past its interface.
- **The list card**: a new test file drives it with a real synced read and a real change against the local stack, as a Household Account and as a Device. The cases that retyped the hook's writes by hand move there. New cases pin what no test reaches today: each write shows at once and the read after it replaces what was shown; a failed write takes back only itself and says the words at the list's place; a write that lands takes them away; a failure on one list is not said on another; the count is unknown while loading, after a failed first read and after a failed write. Prior art: the Routine Chart's tests, and the crossing-off cases in the Shared List tests.
- **Home's card**: a markup case for a failed first read (the alert alone, the name alone) and one for the name with a count. Prior art: the Home list's tests. These fail before the change.
- **Settings**: a pure test of the draft (what each field shows, what a Save sends, nothing when nothing was edited), and a local-stack test that a Save of the name alone leaves the time zone another session set and every Native Event's instants. The Settings cards' markup cases stay. The follow itself is wiring with no DOM test library, so Cory checks it by hand on two phones. Agents do not put a session token into a browser.
- **The form row**: its tests gain opening and closing forgetting what was said, a cancel returning focus to the opener, a removal that landed closing without focus to the opener, and a failed write leaving the row open and its words said. Prior art: the form row's tests against a recorded change.
- **The questions**: markup cases for the two new ones (title, words, the safe button first, the part of day in a Routine's name). The other four keep their cases.
- **The send**: a new test file drives every press with a fake share, a fake copy and a real change: Open, a resolved share, a closed share sheet, a failed share, a copy that worked, a copy that failed, a press while a mark or a share is on its way, and the share called in the same turn as the press. The cases of the share's end move there, and the cases that drove only the change with literal places are replaced by presses through the core.
- **The clock**: one table of zone, date, time and expected instant, as literals, run through the Household clock and through the SQL function as a Household Account: a plain time, a skipped time and a time that happens twice in Chicago, London and Auckland, and on Lord Howe. The clock's own cases of a skipped time and a time that happens twice move into the table. The Repeat and re-anchoring tests pass unchanged. An anonymous session cannot call the function.
- **The row**: a pure test of the row's defaults, caps and refusals. On the local stack, through each provider's sync with its injected fake, two untitled events at the same time read back from the Occurrences as two.
- `pnpm typecheck`, `pnpm lint` and the suite pass on each ticket.

## Out of Scope

- Any new feature, words, colours, layout or timing beyond the six named fixes.
- Everything in "Dropped after the review".
- The Household Date in SQL, which stays inline.
- The Got it sheet and the suggestions' hook.
- Changing #294's pull request before it merges.
- A Household context (ADR 0004); splitting the change's guard or a page-wide failure string (ADR 0006); the Edge Functions' shared frame; a DOM test library.
- Renaming the Google-named columns that hold iCloud data.

## Further Notes

- Each ticket is one PR into `owner/v19`, cut from master after v18 merges, and released to master as one PR, as v11, v13 and v14 were. The fleet tenant's default branch points at the build branch while it is built and goes back to master after the release.
- The two defects the family can see (Home's card and the old time zone) were found by reading the code. Tickets 1 and 2 pin each with a test first.
- The review's report, with before and after diagrams, was a temp file; this spec and PLAN.md are its record.
