# Nidus v12: a time to tap, and events that repeat

Tracker: GitHub issue #235; its sub-issues #236 to #238 are the tickets. Vocabulary: [CONTEXT.md](../../CONTEXT.md) (Native Event, Repeat, Occurrence, Household Date, Household Timezone, Device, Household Account, Routine). Decisions: [PLAN.md](../PLAN.md) ("v12: a time to tap, and events that repeat"). [ADR 0005](../adr/0005-native-events-repeat-expanded-by-the-database.md) records the reversal of "a repeating event belongs in Google" and where Occurrences come from. The look: [look.md](../look.md) (A sheet, A field, Touch, Type). v8's rulings hold for every ticket: replace don't layer, plain TypeScript cores with thin hooks, facts not sentences, the lib client first, no DOM test library.

## Problem Statement

Two things the family does at the Add event sheet are harder than they should be.

- **Setting a time.** Starts and Ends are steppers: a minus, "2:00 PM", a plus, a quarter hour a press, held to repeat. Reaching 4:30 PM from 9:00 AM is thirty presses or a long hold watched closely, and a time off the quarter hour (4:37) cannot be set at all. Nothing can be typed.
- **An event that happens every week.** PLAN.md dropped repeating Native Events ("a repeating event belongs in Google"), but the household's own things have no home in Google: a child's practice, a lesson, custody weeks. Today each week is added by hand, or not at all. Synced Events already repeat (Google expands them; Nidus expands an iCloud feed's), and Routines already run on weekdays; Native Events are the one thing on the Wall that cannot.

## Solution

- **A time sheet.** Starts and Ends become fields that show their time; a tap opens a small sheet over the form with three drums (hour, minute in fives, AM or PM) that roll under a finger, and a field to type a time in any plain way ("4", "4:30", "430", "16:30", "4pm"). Done sets it; Cancel, Escape or the scrim leaves it. Moving Starts keeps the event's length; an end at or before its start is refused in words. The steppers go.
- **Repeats.** The form gains a Repeats row: Doesn't repeat, Every day, Every week, Every month, Every year. A Repeat can be every N (every 2 weeks), a weekly one has its weekdays, and any ends never or on a date. An Occurrence of a Repeat opens, is reminded of, and shows on the month like any event; its details say "Every week on Tuesday, until Dec 20". Editing or deleting one asks "This one, or every one?". Nothing marks a repeating event on its pill.
- **Where the Occurrences come from.** The database. The Repeat is columns on the Native Event, and the `calendar_occurrences` view expands it as it is read, two years ahead and back to the first day, leaving out the days skipped. Every reader of the view sees the same Occurrences, the push reminders included, and no job runs.

## User Stories

1. As a parent at the Wall, I want to tap the start time and roll to 4:30 PM, or type it, so that setting a time takes a moment and not thirty presses.
2. As a parent on the phone, I want the same time sheet to rise from the foot, with rows a finger can hit, so that the phone is no harder than the Wall.
3. As a parent typing "437" or "4:37 pm", I want the event at 4:37 PM, so that a time off the quarter hour is possible.
4. As a parent who moves the start from 9 to 4, I want the end to move with it and the event to stay an hour, so that I set one time, not two.
5. As a parent who sets an end before the start, I want to be told in words and kept in the sheet, so that nothing is saved wrong.
6. As a parent adding soccer, I want to say "Every week" on Tuesday and Thursday until the season ends, so that it is on the Wall every week without me.
7. As a parent with custody every other week, I want "Every 2 weeks", so that the pattern is the real one.
8. As a child at the Wall, I want this Tuesday's soccer to look and open like any event, so that nothing is different to learn.
9. As a parent who opens one Tuesday's soccer and deletes it, I want to be asked "This one, or every one?", so that a cancelled practice does not cancel the season.
10. As a parent who moves one Tuesday's soccer to 5 PM, I want that day alone to change and the rest to stay, so that one exception does not rewrite the rule.
11. As a parent who changes the season's end date, I want "every one" to take it, so that the rule is changed in one place.
12. As a parent with event reminders on, I want a reminder before each Tuesday's soccer, so that a Repeat reminds like any event.
13. As a parent reading the details, I want to read "Every week on Tuesday and Thursday, until Dec 20", so that I know what I set.
14. As a Device (the Wall), I want to add, change and delete a Repeat and skip a day of it, as I may any Native Event today.
15. As a family member, I want nothing else to change: Synced Events, Routines, the look, the words.

## Implementation Decisions

### Rulings (settled with the owner, 2026-10-13, one round, every recommendation taken)

- **The reversal is recorded**: PLAN.md's "a repeating event belongs in Google" is reversed for the household's own things, in ADR 0005. ADR 0002 stands: the mirror is untouched.
- **Glossary**: **Repeat** and **Occurrence** enter CONTEXT.md (done). A Repeat is never completed; that is a Routine. The family reads "Repeats".
- **Shapes**: every N days; every N weeks on chosen weekdays; every N months on the same date (a month without it is skipped); every N years on the same date. N is 1 to 99. No "second Tuesday", no "this and the ones after".
- **The end**: never, or on a Household Date (the last day an Occurrence may land on). No "after N times".
- **One Occurrence**: "This one" or "All", at Save and at Delete. Deleting this one skips its day. Saving this one skips its day and writes a standalone Native Event with the form's title, times, people and words, with no Repeat, in one transaction. Saving all writes the Native Event: its first day moves by as many days as the form's date moved from the Occurrence's, and its times, words, people and Repeat are the form's.
- **Horizon**: two years ahead of the Household's clock, every past Occurrence back to the first day, except that a day or week Repeat stops two years back (spec 0016). The view expands at read time; nothing runs at midnight.
- **Telling a Repeat apart**: only the details sheet, a "Repeats" line. No mark on a pill.
- **The time sheet is ours**, not `<input type="time">`: a native time control differs on each screen Nidus runs on (a clock dial in Fully Kiosk, a typed field with a list on the Elo's Windows Chrome, drums on an iPhone). Ours is the same everywhere, 48 px rows, from the look's tokens. The typed field is a plain text input, so the keyboard is the same everywhere too.
- **The time sheet replaces the steppers.** One way to set a time; the quick nudge is a roll of the drum.
- **Drums**: minutes in fives; any minute by typing.
- **Start moves end**: the length is kept. Changing the end alone changes the end. An end at or before the start is refused in words. An event ends on its own day (the last end is 11:59 PM), as before.
- **One spec, three build tickets**: the time sheet; the Repeat's schema and view; the Repeats control and the words. The first two are disjoint and build in parallel; the third follows both.

### The time sheet

- A core, `src/lib/time-picker.ts`, with no DOM: `parseTypedTime(text): 'HH:MM' | null` accepting "4", "4:30", "430", "1630", "16:30", "4pm", "4:30 pm", "4.30", "4 30", with and without a meridiem (no meridiem: 1 to 12 keeps the field's current meridiem, 13 to 23 is itself, "12" is noon with no meridiem); `drumOf('HH:MM')` giving `{ hour: 1..12, minute: 0..55 by 5 (the nearest below), meridiem }` and `timeOfDrum(drum)` back; the two time setters (the event draft's `setTime` since spec 0015) keeping the length (the end clamped to 23:59) and refusing an end not after the start with a `{ problem }` ("The event must end after it starts."). `stepStart`, `stepEnd`, `QUARTER`, `LAST_START` and `LAST_END` go; their tests' cases become cases on `setTime`.
- A component, `src/components/TimeSheet.tsx`: a `Sheet` (the one frame) titled "Starts" or "Ends", at most 420 wide on the Wall and rising from the foot on the phone, holding the typed field (labelled "Time", 17 px, its hint "Type a time like 4:30 PM"), the three drums (each a column of 48 px rows that scroll-snaps, two rows of room above and below so the chosen row sits centred, the chosen row in `--foreground` at 600 and the rest `--muted-foreground`; CSS scroll snap, no library; the value read on `scrollend` with a 150 ms fallback for a browser without it) and a footer of Cancel and Done (56 tall). A roll of a drum rewrites the field; a typed time that parses rolls the drums; Done or Enter sets the form's time through the draft's `setTime`, and a `problem` is said in the sheet's footer and keeps the sheet open. The drums are `aria-hidden`: the typed field is the accessible control, the keyboard's and a screen reader's way.
- A second Sheet over the form: it stops the keydown it handles from reaching the form's dialog (Escape must close the time sheet, not the form), its scrim closes it (nothing typed is kept), and on close focus returns to the field that opened it (the Sheet's own rule). The form's `canDismiss` and its untouched rule are unchanged.
- In `NativeEventSheet.tsx`, `Stepper` and `StepButton` go. Starts and Ends are each a `button` (60 tall, `--muted` fill, 16 round, captioned as today) showing the time as the steppers did (Young Serif, the meridiem small), `aria-label` "Starts, 2:00 PM"; a tap opens the time sheet for that one. All day hides both, as today. `keepTimes` holds once a time has been set.

### The Repeat's schema and view

- Migration `20261023000001_native_event_repeats.sql`. `native_events` gains `repeat_every text check (repeat_every in ('day', 'week', 'month', 'year'))`, null when the event does not repeat; `repeat_interval smallint not null default 1 check (between 1 and 99)`; `repeat_days smallint check (between 1 and 127)`, the Routines' bitmask (bit n set: weekday n, Sunday 0), required when `repeat_every = 'week'` and null otherwise; `repeat_until date`, a Household Date, null for forever. One check: a null `repeat_every` has interval 1, null days and null until. The insert and update grants gain the four columns.
- `native_event_skips (native_event_id uuid, profile-style composite foreign key to native_events (id, household_id) on delete cascade, household_id uuid, skipped_on date, primary key (native_event_id, skipped_on))`, with the policies and grants of `native_event_profiles` (a Device writes it; `household_id = current_household_id()`), added to the realtime publication, and to `WATCHED_TABLES` and `OCCURRENCE_TABLES` in `src/lib/realtime.ts`.
- `save_native_event` gains `p_repeat_every text, p_repeat_interval smallint, p_repeat_days smallint, p_repeat_until date` and `p_skip_event uuid, p_skip_on date`: when `p_skip_event` is given, it inserts that skip (its Household checked) in the same transaction, before the write. It refuses `p_repeat_until` before the event's first Household Date, and a week with no days.
- The view is recreated. The `native` half becomes one row per Occurrence: for an event with no Repeat, the row as today; for a Repeat, a `lateral` call of `public.native_event_occurrences(native_events)` (a `language sql` function, `stable`) returning `(starts_at, ends_at)` for every day its Repeat lands on, from its first day (a day or week Repeat starts at the later of that day and two years before the Household's clock today: the two-year floor of spec 0016) to the earlier of `repeat_until` and two years after that today, minus `native_event_skips`. The first day and the time of day are the event's `starts_at` read in the Household Timezone; the length is `ends_at - starts_at` in instants (an all-day event's days are kept as days). Weeks start on Sunday, `repeat_days` picks the days, and the interval counts weeks from the first day's week. Months and years keep the date, and a month or year without it (the 31st, Feb 29) is skipped. The instant of a day's time is the Household Date rule: a time the clocks skip moves forward by the gap (Postgres's own), and a time that happens twice is the first (checked: the instant an hour earlier that still reads the same wall clock wins over Postgres's standard-time default).
- The view's columns grow: `event_id uuid` (a Native Event's own id; null for a Synced Event), `repeat_every`, `repeat_interval`, `repeat_days`, `repeat_until` (null for a Synced Event and an event with no Repeat). `id` stays the event's for an event with no Repeat; for a Repeat it is `md5(event id || starts_at)::uuid`, the same every read. `Occurrence` in `src/lib/calendar-occurrences.ts` and `occurrenceColumns` gain the five. Nothing else in the client changes in this ticket; `loadOccurrences`'s dedupe key `${source} ${id}` is already per Occurrence, and push-notify's reminder key `event:${source}:${id}:${startsAt}` is too.
- Deleting a Native Event stays `delete from native_events`: its skips go with it.

### The Repeats control and the words

- `EventForm` gains `repeat: Repeat | null` with `Repeat = { every: 'day' | 'week' | 'month' | 'year'; interval: number; days: number; until: string | null }` (`days` only meaningful for `week`; the form keeps the first day's weekday set by default). `NativeEventInput` gains the four columns and `skip?: { event: string; on: string }`; `eventFormToInput` validates them (a week with no days: "Pick at least one day."; an end before the first day: "The repeat ends before it starts."); `saveNativeEvent` passes them; `eventFormFromOccurrence` reads the Occurrence's Repeat.
- `repeatWords(repeat, firstDate): string` in `src/lib/native-events.ts`: "Every day", "Every 2 days", "Every week on Tuesday", "Every 2 weeks on Monday and Wednesday", "Every week on Monday, Tuesday, Wednesday, Thursday and Friday", "Every month on the 15th", "Every 3 months on the 1st", "Every year on Oct 6"; ", until Dec 20" (the year when not this year, by `dateWords`) when it ends. Plain words, no em-dashes.
- The form's Repeats row, under All day in the left column: a caption "Repeats" and pills (52 tall, as When's) "Doesn't repeat", "Every day", "Every week", "Every month", "Every year", one pressed. When one but "Doesn't repeat" is pressed, under them: "Every" with a number field (`inputmode="numeric"`, 1 to 99, 60 tall) and the unit's plural ("weeks"); for a week, seven weekday chips (52 tall, the short names, pressed for the days, the Routines' bitmask); and "Ends": pills "Never" and "On a date", the latter showing a `date` input as "Another day" does. The sheet scrolls between its title row and its footer, as it does for a large family.
- Editing an Occurrence of a Repeat: Save asks in the footer, as Delete's question does today, "Change this one, or every one?" with "This one" and "Every one"; Delete asks "Delete this one, or every one?" with "This one" and "Every one". "This one" on Save writes a standalone event with the form's fields and no Repeat, skipping the Occurrence's day through `p_skip_event`, and says "Saved <title>: <day, time>"; a change to the Repeats row is dropped with it. "This one" on Delete inserts the skip and says "Deleted <title> on <day>". "Every one" writes the Native Event by `event_id`, its first day moved by the form's day delta, and says "Saved <title>: <the first day's words, time>"; deleting every one deletes the event and says "Deleted <title>". A Native Event with no Repeat asks nothing, as today.
- `EventDetails` shows a "Repeats" line (`repeatWords`) after "When" for an Occurrence with a Repeat.
- The phone's upcoming list and the Wall read Occurrences as today; an Occurrence's key is its `id`.

### Schema

Migration `20261023000001_native_event_repeats.sql`, above. Pushed to hosted by the owner at the release, as before.

## Testing Decisions

- Through the one seam: the Supabase JS client against the local stack as a Household Account and a Device; the plain cores without a DOM; screens as static markup.
- **Time picker core** (`tests/time-picker.test.ts`): every typed form above and the refusals ("", "25", "4:60", "abc", "13 pm"); `drumOf` and `timeOfDrum` round-trip; `setTime` keeps the length of a start and clamps at 23:59, and refuses an end at or before the start; every case of the old stepper tests carried over by name.
- **Time sheet** (`tests/time-sheet.test.ts`, static markup): the field, its hint, the drums hidden from a screen reader, Done and Cancel at 56, the title.
- **Native Event form** (`tests/event-form.test.ts`): the Starts and Ends buttons and their labels; the Repeats pills; the weekday chips for a week; the Ends pills; the questions at Save and Delete for an Occurrence of a Repeat and their absence for an event with none.
- **Repeats in the database** (`tests/native-events.test.ts` and a new `tests/native-event-repeats.test.ts`): as a Household Account and as a Device: a weekly Repeat on two days reads back as the right Occurrences for a month, each with its own `id` and the event's `event_id`; every 2 weeks skips the week between; monthly on the 31st skips June; yearly on Feb 29 lands only in a leap year; `repeat_until` is the last day; a skip takes its day out and a second read is the same; the Repeat moves forward by the gap on the day the clocks go forward and takes the first of a twice-struck hour (a Household in America/Chicago on 2026-03-08 and 2026-11-01); the two-year horizon; `save_native_event` with `p_skip_event` writes the skip and the new event in one transaction and refuses another Household's event; a Device may write a skip; another Household reads none. `repeat_until` before the first day and a week with no days are refused.
- **Words** (`tests/native-events.test.ts` or `tests/event-words.test.ts`): `repeatWords` for every shape, with and without an end, and the Saved and Deleted sentences for this one and every one.
- **Details** (`tests/event-details.test.ts`): the Repeats line present for a Repeat, absent otherwise.
- **Reminders** (`tests/push-notify.test.ts`): a weekly Repeat gets a reminder for the Occurrence due, keyed by its start, and none for a skipped day.
- Opus reviews each PR against this spec before it merges; a regression it finds is fixed in the same PR.

## Out of Scope

- "This and the ones after", "after N times", "the second Tuesday", "every weekday" as a shape (it is a week on five days).
- A mark on a repeating event's pill.
- Repeats for Synced Events (they already repeat in their source) and for Routines (they have days).
- An event that runs past midnight.
- A native `<input type="time">`.
- Seconds, 24-hour display (the Wall says "4:30 PM" everywhere today), and a locale other than the Wall's.

## Further Notes

- Each ticket is one PR into `owner/v12`, released to master as one PR, as v11 was. `owner/v12` is cut from master. The release pushes the migration to hosted (the owner's step) and deploys nothing else: push-notify reads the view and needs no change.
- Builders are Sonnet; QA on each PR is Opus; research is Haiku; rulings and diagnosis are the owner's session.
