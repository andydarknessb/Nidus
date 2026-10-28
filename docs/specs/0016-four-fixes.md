# Nidus v15: four fixes

Tracker: GitHub issue #270; its sub-issues #271, #272, #273 and #274 are the tickets, one per section below and in its order. Vocabulary: [CONTEXT.md](../../CONTEXT.md) (Household Timezone, Household Date, Native Event, Repeat, Occurrence, Calendar Account, Mirrored Calendar, Synced Event, Push Subscription, Pinned List). Decisions: [PLAN.md](../PLAN.md) ("v15: four fixes"). ADR [0002](../adr/0002-read-only-calendar-mirror.md) (only the sync writes Synced Events) and ADR [0005](../adr/0005-native-events-repeat-expanded-by-the-database.md) (Repeats expanded as they are read) stand.

## Problem Statement

An audit of master on 2026-10-27 found four places where the family sees the wrong thing.

- **Changing the time zone moves the family's own events.** A Native Event is stored as two instants. When a grown-up changes the Household Timezone in Settings, those instants stay, so the clock times and dates the family typed move. On the local stack, a one-off all-day event on Monday, November 2, made in New York, ran from Sunday 9 PM to Monday 9 PM after a switch to Los Angeles, and showed on both days as "All day". A yearly Repeat on November 2 moves to November 1, because its first day is read again in the new zone. A timed event typed as 9:00 AM shows at another hour. Google and iPhone all-day events sit across two days until the next full read, up to 24 hours later.
- **A Google calendar that is gone never leaves the Wall.** When a selected Mirrored Calendar is deleted, or is no longer shared with the connected Google account, Google answers 404 on every run. The sync treats every answer that is not a success as a passing failure and keeps the old Synced Events. So those events stay on the Wall, up to six months ahead. Settings says "the last update failed" for the whole account, and after an hour the Wall shows a "Last synced" badge, though the account's other calendars still sync. Only finding and unticking the right calendar clears it.
- **One wrong year on a daily Repeat slows every screen.** Each read of the calendar expands a Repeat from its first day. A daily Repeat whose year was typed as 0202 instead of 2026 makes about 670,000 rows per read. On the local stack a one-week read went from 4 ms to 2.2 s. The Wall, every phone and the minute's notification run read it again and again, and a second such event pushes a read past the 8-second limit, so the calendar stops loading.
- **A list notification can hide the item before it.** Items added to the Pinned List wait a minute before a notification, so that quick typing arrives together. The wait is "older than a minute", not "a minute with nothing added". "Milk" added at 12:00:50 and "eggs" at 12:01:10 go out in two runs. Both notifications carry the same tag, so the phone replaces the first with the second and shows only "eggs".

## Solution

- A Household Timezone change keeps every Native Event on the Household Date and clock time it was entered with: one-off and Repeat, all-day and timed, past and future. Synced Events follow their source: the next sync run reads every Mirrored Calendar of the Household in full, in the new zone.
- When Google says it cannot find a Mirrored Calendar, that calendar leaves Nidus with its Synced Events, without a word to the family. The Calendar Account stays "Connected" and its other calendars count as synced.
- A day or week Repeat is expanded from at most two years before the Household's today, as it already stops two years after it.
- The "Added to {list}" notification names every item of the last 15 minutes that someone else added and nobody crossed off, so the notification that replaces another still holds everything the older one said.

## User Stories

1. As a parent who set the wrong time zone, I want to correct it in Settings without my all-day events spreading onto two days, so that the Wall still shows each one on its day.
2. As a parent, I want a birthday that repeats every year to stay on its date after I change the time zone, so that nobody is wished a happy birthday a day early.
3. As a parent, I want an event I typed as 9:00 AM to still say 9:00 AM after I change the time zone, so that the appointment is where I put it.
4. As a family moving house, I want events I typed before the move, for after it, to keep the clock times I typed, so that they are right once the Wall is on the new time zone.
5. As a parent, I want a Repeat's days I deleted or changed on their own to stay deleted or changed after a time zone change, so that nothing I removed comes back.
6. As a parent, I want a Repeat's end date to stay the date I chose after a time zone change, so that it stops when I said.
7. As a parent, I want the people an event is for to stay the same after a time zone change, so that nothing but the zone changes.
8. As the family at the Wall, I want Google and iPhone all-day events back on their own day within minutes of a time zone change, so that the calendar is right before anyone notices.
9. As the family at the Wall, I want timed Google and iPhone events to stay at the instants their calendars hold, so that a time zone change never moves an appointment someone else made.
10. As a parent, I want a time zone change made by any grown-up, from any phone, to behave the same way, so that it does not matter who fixes it.
11. As the family at the Wall, I want the Wall and every phone to show the moved events at once, so that no screen is left on the old times.
12. As a grown-up with event reminders on, I want a reminder for an event whose time moved with the time zone to come before its new time, so that it is not missed.
13. As a parent whose partner deleted a Google calendar, I want its events to leave the Wall, so that the family does not plan around things that no longer exist.
14. As a parent whose Google calendar is no longer shared with the account I connected, I want it to leave Nidus, so that the Wall shows only what that account can still see.
15. As a parent, I want a calendar that left to disappear from the calendar's list in Settings too, so that I am not offered a calendar that cannot be read.
16. As a parent, I want the account's other calendars to keep showing as synced after one of them is gone, so that Settings does not say an update failed when nothing is wrong.
17. As the family at the Wall, I want no "Last synced" badge because of a calendar that no longer exists, so that the badge means the Wall really is behind.
18. As a parent, I want a calendar that is shared again to be offered again when I reconnect the account, so that I can pick it again.
19. As a parent, I want Google being busy, or limiting how often the sync may ask, to stay a passing failure, so that a calendar is never removed because Google was briefly unavailable.
20. As a parent with an iPhone calendar, I want it handled as it is today, so that this change touches Google calendars only.
21. As the family at the Wall, I want the calendar to load as fast as usual even if someone typed a wrong year on a daily Repeat, so that one typo does not slow every screen.
22. As the person who made that typo, I want the daily Repeat to still show today and the days after, so that I notice it and can fix its date.
23. As a parent, I want a weekly Repeat started years ago (every other Tuesday since 2019) to still show on the right Tuesdays, so that the floor never shifts a series.
24. As a parent, I want a Repeat every 3 days started long ago to still land on the right days, so that its interval keeps its rhythm.
25. As a parent, I want monthly and yearly Repeats to show as they do today, however long ago they started, so that a birthday from 1958 still shows every year.
26. As a parent paging back in the month view, I accept that daily and weekly Repeats more than two years back are not shown, so that the calendar stays fast.
27. As a grown-up with list notifications on, I want each notification to name every item added in the last 15 minutes by someone else, so that a newer notification never hides an older item.
28. As a grown-up, I want items I added myself left out of my own notification, so that it tells me only what others added.
29. As a grown-up, I want a list notification only when something new was added, so that the phone does not buzz again for items it already told me of.
30. As a grown-up, I want items crossed off since they were added left out of the notification, so that it lists only what is still needed.
31. As a grown-up, I want items added from the Wall to reach me as before, so that the tablet's additions are not lost.

## Implementation Decisions

### 1. A time zone change re-anchors Native Events

- A trigger on the Household's row fires when its time zone changes, in the same transaction, for every writer: a Household Account in Settings, the service role, a person in the SQL editor. Settings' save is unchanged.
- It rewrites every Native Event of the Household, past and future, one-off and Repeat, all-day and timed: its start and end become the same wall-clock date and time in the new zone (each read on the old zone's clock, then placed on the new zone's). The Household Date rule settles a time the new zone's clocks skip (it moves forward by the gap) or pass twice (the first).
- Skipped days, a Repeat's end date and its Profiles are Household Dates or links, and are left alone. A Repeat's Occurrences follow from its first day and time, so they move with it.
- The trigger never writes Synced Events (ADR 0002). It clears the last full read of every Mirrored Calendar of the Household, so the next run reads each in full: Google's all-day events land on the new zone's midnights, and an iPhone feed is fetched without its validators and expanded in the new zone. Timed Synced Events keep their instants.
- It is `security definer` with an empty `search_path`, like the repo's other triggers, because it writes a column of Mirrored Calendars that no client may write.
- The rewritten rows reach every screen through the change feed as any write does; a moved event's reminder key carries its new start, so its reminder is due before the new time.

### 2. A Mirrored Calendar Google cannot find leaves Nidus

- In the Google adapter, a 404 for a calendar's events, on a full read or with a sync token, means the calendar is gone. Google's errors guide gives 404 as "the specified resource was not found", including a calendar the user cannot access; it does not tell a deleted calendar from an unshared one, and both count.
- A gone calendar's Mirrored Calendar is deleted with the service role, and its Synced Events go with it by cascade. It is not a problem: when every other selected calendar synced, the account's outcome is synced, so `last_synced_at` moves and `last_error` is cleared.
- 403 and 429 (rate and quota limits, which Google says to back off from and retry) stay passing failures. A 410 with a sync token stays the existing fall back to a full read.
- Nothing tells the family. Settings no longer lists the calendar, and the Wall loses its events at the next read.
- Reconnecting the account lists the calendar again, unselected, if Google lists it.
- The iPhone adapter is unchanged: a link that is gone already makes its account need reconnecting.

### 3. Day and week Repeats expand from at most two years back

- In the function that expands a Repeat, a day or week series starts at the later of the Repeat's first day and two years before the Household's today, the same today its two years ahead are counted from. A new migration replaces the function with the same signature; the view does not change.
- A day series' start is rounded down to a whole number of intervals from the first day, so it lands on the same days. A week series tests each day against its weekdays and against its interval counted in weeks from the first day's week, so any start keeps the same days.
- Month and year Repeats are unchanged: they step by month or year and stay cheap however old.
- The event form keeps every date it takes today. The shortcut note on the function names the two-year reach each way.
- Spec 0013 and ADR 0005 say the expansion starts from the event's first day; both gain the two-year floor for day and week Repeats.

### 4. The list notification names every recent item

- What is due is unchanged: items of the Pinned List, not crossed off, added more than 1 minute and at most 15 minutes ago, whose `added_by` is not the Push Subscription's account; one key per item.
- A notification is sent only when the claim made at least one new key, as now. Its body names every due item for that subscription, claimed in this run or an earlier one, in the order they were added, joined with ", " and cut at 300 characters.
- The title, tag and address are unchanged. The tag still replaces the earlier list notification, which is now harmless: the newer one names everything the older one did, within the 15 minutes.
- Spec 0007's "Added to the list" rule changes from "the items claimed in one run go in one notification" to this.

## Testing Decisions

- One seam, as every test in the repo: the Supabase JS client against the local stack, acting as a real principal (a Household Account, a Device). The outside HTTP is the only fake: the fake Google `fetch` for the sync, the fake `sendPush` for the notifications. The database is never mocked.
- A good test asserts what a principal reads back (`calendar_occurrences`, a Calendar Account's facts, the payload handed to `sendPush`), never the SQL or the calls inside.
- **Time zone**: as a Household Account, add in America/New_York an all-day one-off, a yearly all-day Repeat with one skipped day and an end date, and a timed 9:00 AM one-off for two Profiles; change the Household Timezone to America/Los_Angeles; read `calendar_occurrences`: the all-day one-off is on its one Household Date, the Repeat lands on its dates with the skipped day absent and stops at its end, the timed event reads 9:00 AM on Los Angeles' clock and still names both Profiles. A Device's read agrees. With the service role, every Mirrored Calendar of the Household has no last full read, and the next sync run asks the fake Google with no sync token. Prior art: `tests/native-event-repeats.test.ts`, `tests/households.test.ts`, `tests/calendar-sync.test.ts`.
- **Gone calendar**: the fake Google answers 404 for one of two selected calendars: the run removes that Mirrored Calendar and its Synced Events, keeps the other's, and the account reads synced, with no `last_error` and a moved `last_synced_at`. The same with a sync token. A 403 `rateLimitExceeded` and a 429 keep the calendar and its events and mark the account failed, as today. Prior art: `tests/calendar-sync.test.ts`.
- **Repeat floor**: a daily Repeat whose first day is in the year 202 shows today and tomorrow and nothing more than two years back, and a one-week read answers in under a second. An every-3-days Repeat and an every-other-week Tuesday and Thursday Repeat, both from 2019, land on the days counted from their first day. A yearly Repeat from 1958 shows this year. Prior art: `tests/native-event-repeats.test.ts`.
- **List notification**: with the fake `sendPush`, someone else adds "milk", and a run past the minute sends "milk"; "eggs" is added, and a run past its minute sends "milk, eggs" with the same tag; a run with nothing new sends nothing; an item crossed off between runs is left out; the subscriber's own item is never named; a Device's item is. Prior art: `tests/push-notify.test.ts`.

## Out of Scope

- Rewriting Synced Events when the time zone changes: only the sync writes them (ADR 0002).
- Telling the family a Google calendar left, and offering a Google account's new calendars without reconnecting (its calendar list is still read only at connect).
- A date rule on the event form; any change to month and year Repeats; writing Occurrence rows instead of expanding them.
- Waiting for a minute with nothing added before a list notification, and dropping the list notification's tag.
- Leaving unchanged Synced Events unwritten on a full read (the audit's fifth finding, dropped).
- The parts of the app the audit did not read: the screens and their parts, and the Routine Chart, Day view, paged view, month grid and schedule modules.

## Further Notes

- The findings come from the audit on 2026-10-27; every decision came out of the grilling that followed. `CONTEXT.md`'s Household Timezone and Mirrored Calendar entries were sharpened with it.
- Four tickets with no blockers between them, each its own pull request into `master` that closes its ticket. Tickets 1 and 3 add migrations, which the owner pushes to the hosted project after merge.
- Google's own words on the status codes: the errors guide at developers.google.com/calendar/api/guides/errors (404 "The specified resource was not found"; 403 and 429 rate limits "should be responded to ... by using exponential backoff"; 410 for a sync token that is no longer valid).
