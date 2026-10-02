# Nidus v2 — closing the gaps with Skylight Calendar

Tracker: GitHub issue #53; its sub-issues (#54 to #60) are the tickets. Vocabulary: [CONTEXT.md](../../CONTEXT.md). Decisions: [PLAN.md](../PLAN.md) (v2 section), ADR [0001](../adr/0001-supabase-over-custom-backend.md), ADR [0002](../adr/0002-read-only-calendar-mirror.md). Research: [skylight-comparison.md](../skylight-comparison.md).

## Problem Statement

Skylight Calendar is the commercial product Nidus stands in for. Compared feature by feature (`docs/skylight-comparison.md`), the Wall is behind it in ways the family meets every day. It shows no clock, date or weather. It has no month view. On a busy week nobody can pick out one person's events. Routines are a flat list: no morning or evening, no sense of progress, nothing that marks finishing them, and a Routine cannot be edited once made. There is nowhere to write what is for dinner. And the views the Wall does have hang off a row of header buttons with no room for another.

## Solution

The Wall gets a shell that can hold more: a navigation rail down the left side and a header that carries the Household's name, the time and date, the weather and a chip per Profile for filtering the calendar; Add event moves to the foot of the rail. On that shell it gains a month view, a full-screen Routines chart with progress and a small celebration when someone finishes, Routines grouped by time of day and editable from the phone, and a plain meal plan for the week. Everything stays inside the two load-bearing decisions: Supabase is the whole backend, and Google is mirrored read-only.

## User Stories

### Shell

1. As a family member, I want the time and date on the Wall, so that the calendar on the wall is also the clock on the wall.
2. As a family member, I want one fixed place to move between Home, Day, Week, Month, Routines, Meals and Lists, so that I never hunt for a button.
3. As a family member, I want the section I am on marked in the navigation rail, so that I know where I am.
4. As a family member, I want to tap a day's heading to open that day, so that a busy Saturday is one tap away.
5. As a family member, I want the five day columns to stay as readable as they are today, so that the navigation rail does not cost me the calendar.

### Month view

6. As a family member, I want a month view, so that I can see what the weeks ahead look like at a glance.
7. As a family member, I want each day to show its first few events in their colours and how many more there are, so that a full day reads as full.
8. As a family member, I want to tap a day in the month to open that day, so that the month is a way in, not a dead end.
9. As a family member, I want to page between months as far as the mirror goes, and to be told which days lie beyond it, so that the month view never shows a day that only looks empty.

### Profile filter

10. As a family member, I want to tap my name to see only my events and the whole Household's, so that a crowded week becomes mine to read.
11. As a family member, I want to pick more than one Profile, so that I can see the kids together.
12. As a family member, I want the filter to clear itself after a couple of minutes, so that the next person to walk past sees everything.
13. As a family member, I want a visible sign that a filter is on and one tap to clear it, so that nobody mistakes a filtered Wall for an empty day.

### Routines

14. As a parent, I want to give a Routine a time of day (morning, afternoon, evening), so that the Wall reads in the order the day happens.
15. As a parent, I want to edit a Routine's title, days and time of day, so that a typo does not cost its history.
16. As a child, I want to see how many of today's Routines I have done, so that I know how close I am.
17. As a child, I want something to happen when I finish my last Routine, so that finishing feels like finishing.
18. As a family member, I want a full-screen chart with a column per person, so that everyone's Routines fit on one screen.
19. As a family member sensitive to motion, I want the celebration to respect the reduced-motion setting, so that the Wall never flashes at me.

### Meals

20. As a family member, I want to write what we are eating for breakfast, lunch, dinner or a snack on any day this week, so that "what's for dinner" has one answer.
21. As a family member, I want to change or clear a Meal from the Wall, so that plans can change where they are read.
22. As a family member, I want today's Meals on the home screen, so that I do not have to open anything to see dinner.
23. As a family member, I want a Meal written on one screen to show on every other within a second or two, so that two screens never disagree.

### Weather

24. As a parent, I want to tell Nidus where we live once, by searching for the place, so that the Wall can show our weather.
25. As a family member, I want the current temperature and conditions in the header, so that I know what it is like outside.
26. As a family member, I want each of the next days to show its high, low and conditions, so that I can plan the week's coats.
27. As a parent, I want to choose Fahrenheit or Celsius, so that the numbers mean something to us.
28. As a family member, I want the Wall to keep working when the weather cannot be fetched, and never to show an old reading as if it were now, so that a weather outage costs me nothing and tells me nothing false.

## Implementation Decisions

"The Wall" is the Household's shared view at `/`: the home screen and the views and screens reached from it. PR #51 puts the term in the glossary.

Two things are called a rail. The **navigation rail** is the new column of sections down the left. The **right rail** is the home screen's existing right-hand column: the Routines rail above the Pinned List.

- **Shell**: the Wall is a navigation rail, a header and a screen. The navigation rail lists Home (`/`), Day (`/day`), Week (`/week`), Month (`/month`), Routines (`/routines`), Meals (`/meals`) and Lists. Each entry is an icon over a word, at least 64 px square, with `aria-current="page"` on the current one and a mark that is not colour alone. The rail is at most 90 px wide, padding and border included. Add event sits at the foot of the rail as the one primary action, on every screen. Entries appear as their screens land; a ticket never ships an entry that leads nowhere. Paging stays with `pushState`, as today.
- **Lists**: stays the full-screen Lists screen it is, opened from the navigation rail. It covers the rail while it is open; that is the accepted exception to "one fixed place".
- **Rail and dates**: a calendar view (Day, Week, Month) in the navigation rail opens the page holding today when the page being left holds today, as Home always does; otherwise it opens the page holding the left page's date. One pure function decides for all three. A month page holds today only when today falls in that month, not when it shows as a dimmed day of a neighbouring one. Leaving Routines or Meals, which have no calendar date to keep, a calendar view opens today's page. Meals in the navigation rail always opens this week.
- **Header**: the Household's name, the clock and date in the Household Timezone, the weather, the Profile chips, and the connection and stale-sync badges. At 1280 px that is all the header can hold, which is why Add event lives in the navigation rail. The chips show on the calendar screens only (Home, Day, Week, Month). The Week and Day header buttons, the paged views' Home button and their Day/Week toggle go: the navigation rail replaces them.
- **Add event**: opens the Native Event sheet on today when the page shown holds today, otherwise on the page's first day, pulled inside the mirror's window when that day lies before it.
- **Room**: the navigation rail must not cost the calendar its width. Page padding and gaps drop to 1 rem and the right rail to 22 rem, so at 1280×800 each of the five day columns stays at least 140 px wide (146 px today) and nothing scrolls sideways.
- **Occurrences are read in one place**: a `useOccurrences` hook reads the occurrences for a span of days (the timer, the retry, the change feed). Every calendar view reads through it, so the Profile filter is applied once, inside it.
- **Month view**: `/month?date=YYYY-MM-DD`, anchored on the first of the month. A Sunday-to-Saturday grid of the weeks that touch the month, days outside it dimmed. Each day inside the mirror's window is one button that opens its Day view and shows the date, then its occurrences one line each (colour edge, a compact start time for a timed one such as "10 AM" or "9:30 AM", title), all-day first, then by start, with "+N more" when they do not fit. A day lists an event by its real span, so a short one late in the evening never also appears on the next day. Events are not tappable in the month; the day is. A day beyond the mirror's window is not a button, shows nothing, is hatched so it is told apart by more than colour, and says it is beyond the calendar's range; a week row made only of such days is not read at all. Paging runs inside the window (one month back, six ahead) and says so at either end, as the week view does. The grid reads one week row at a time: the API caps a read at 1000 rows without saying so, and a week cannot reach that.
- **Profile filter**: a toggle chip per Profile in the header (none when the Household has fewer than two Profiles). With none pressed the Wall shows everything. With any pressed, calendar views show the occurrences attributed to a pressed Profile and every whole-Household occurrence. An "Everyone" chip leads the row, pressed while no filter is on; tapping it clears the filter, and the filter clears itself two minutes after the last chip tap. The filter belongs to the screen: it is not saved and not shared between Devices. Routines, Lists and Meals ignore it.
- **Routine time of day**: `routines.time_of_day`, one of `morning`, `afternoon`, `evening`, or null for any time. The Wall groups a Profile's Routines under Morning, Afternoon, Evening and Any time, in that order, showing only the groups that have a Routine today, and no group headings at all when every one of that Profile's Routines today is Any time.
- **Editing a Routine**: the phone's Routines page edits title, days and time of day in place. The update grant already covers title and days; the migration adds the new column to the insert and update grants. Still Household Account only. The phone lists and reorders Routines inside the same groups as the Wall, so it never shows an order the Wall does not.
- **Routines chart**: `/routines`, a column per Profile that has Routines today, in the Profiles' order, each with its name, colour, "2 of 5" and a progress bar, then the same tickable Routines as the Routines rail, grouped the same way. The Routines rail on Home gains the count and a thin bar per Profile. The chart and the Routines rail share one reader hook.
- **Celebration**: on the chart and on Home's Routines rail alike, when a tap on that screen completes the last unticked Routine a Profile has today, a short confetti-style burst plays over that Profile's group (CSS only, under two seconds, no new dependency) and the heading reads "All done" with an icon for as long as it is true. Loading a finished list, or hearing a tick from another screen, plays nothing. Under `prefers-reduced-motion: reduce` there is no animation, only the words.
- **Meals**: a `meals` table: `id` (the only primary key, replica identity default, so a Realtime delete carries nothing else), `household_id`, `meal_date` (a Household date), `slot` (`breakfast`, `lunch`, `dinner`, `snack`), `title` (1 to 200 characters), unique per Household, date and slot. Both principals read and write their own Household's Meals, a Device included: a Meal is free text on the Wall, the same trust as a list item. One RPC, `set_meal(date, slot, title)`, refuses a caller with no Household, upserts, and clears on a blank title. The table joins the Realtime publication and the change feed.
- **Meals screen**: `/meals?date=`, a week (Sunday to Saturday) by slot grid, paged inside the calendar's window with its own words at the ends. Each cell is a button showing the Meal or an invitation to add one; tapping opens a small sheet with one text field, Save, Clear and Cancel. Home shows a compact "Today's meals" card above the Routines rail, one line per planned slot, and nothing when none is. Today, and paging back onto this week, leave the address without a date, so a Wall left on Meals follows the week. The card and the screen's today mark move on at Household midnight.
- **Weather**: the Household gains `weather_place`, `latitude` and `longitude` (all three set or all three null; `numeric` columns with two decimals, so the database does the rounding) and `temperature_unit` (`fahrenheit` by default, or `celsius`). The phone's settings search a place by name through Open-Meteo's geocoding API and save the pick; "Turn weather off" clears it. The screen itself fetches the forecast from Open-Meteo (no key, no server hop, nothing stored), every 30 minutes, asking for the Household Timezone so the daily dates are Household dates. A failed fetch keeps the last reading, but current conditions more than two hours old are dropped rather than shown as now; the daily figures, keyed by date, stay. With no place set nothing is shown or fetched. Settings credits "Weather data by Open-Meteo.com".
- **What weather sends out**: each screen sends the Household's rounded coordinates and timezone, and its own IP address, to Open-Meteo every 30 minutes; the phone sends the typed place name to Open-Meteo's geocoder. No Household id, token or cookie goes with either request, and no referrer; the browser adds only what it adds to any request (its user agent and language, and the site's origin).
- **Weather on the Wall**: the header shows the current temperature with an icon whose accessible name is the condition in words, and today's high and low. Day headings on Home, Day and Week show that day's icon, high and low when the forecast covers the date, outside the heading's button, so the button's name does not change: on a line of their own under the day on Home and Week, beside the day on the Day view; every heading in a row keeps that line, empty where the forecast does not reach, so the row never jumps.
- **Schema**: three additive migrations: `20261012000001_routine_time_of_day`, `20261013000001_household_weather`, `20261014000001_meals`. Each reaches the hosted project before the frontend that reads it is merged, so the deployed Wall never asks for a column that is not there. One migration-bearing ticket goes at a time: its branch is rebased on `master`, the migration is pushed immediately before the merge, and the merge follows straight after, so every migration already on the hosted project is in the directory being pushed. Tickets merge in timestamp order where they can, and a file that sorts before one already pushed goes up with `supabase db push --include-all` (the three are independent). When one pull request carries all three, as the v2 one does, push all three with a single `supabase db push` from its branch immediately before merging it: the frontend it deploys reads the new Household and Routine columns on every screen, and listens for `meals` on the one change feed, so a deploy that gets ahead of the push leaves the Wall and the phone unable to load.
- **Nothing changes in the mirror**: no Edge Function, cron job or sync behaviour is touched.

## Testing Decisions

- **Seam**: unchanged. Every new column, table and RPC is exercised through the Supabase JS client against the local stack as each principal: the Household Account, a Device, another Household's principals, an unpaired anonymous session (it runs as `authenticated` and holds the same grants; only row-level security stops it), and a client with no session. Tests assert what each can read and write, never which policy said no.
- **Pure logic**: unit tests for the month grid (month ends, a 23 and a 25 hour day), which days lie beyond the window, month paging at both ends, a day cell's order and overflow count, the navigation rail's date rule, Add event's default day, the Profile filter, Routine grouping by time of day and the move inside a group, progress and the "this tap finished the Profile" decision, the week of Meals by day and slot, and the forecast parser, condition words and staleness rule. All date logic takes the Household Timezone; a test never reads the machine's zone.
- **Weather is not a second fake**: the forecast parser is tested against a recorded Open-Meteo response as data. Nothing fakes or calls the network in tests; Google's HTTP API stays the only fake.
- **Screens**: there is still no component-test harness. Each ticket's screens are checked by hand against the local stack at 1280×800 before merge.

## Out of Scope

- Stars, points and rewards. Routine Completions keep the history a balance would be computed from.
- Recurring Native Events. A repeating event belongs in Google, which the Wall mirrors.
- Two-way sync and any other calendar provider (ADR 0002, PLAN.md).
- Drag to reschedule, tap an empty slot to create, countdowns, reminders.
- Recipes, AI meal plans, sending ingredients to a list or a shop.
- Photo screensaver, sleep schedule, dimming: Fully Kiosk Browser owns these.
- Inbound email or photo import by AI.
- A light theme, font-size setting, per-Profile PIN or roles.
- The phone layout below 768 px (#50) and the Household Account on the Wall (#49): those tickets stay with spec #1. What Month, Routines and Meals look like below 768 px is #50's to settle, which is why #50 waits for this spec's tickets.

## Further Notes

- Build order: the shell and the Routine time of day first, side by side; then Month view, Profile filter, Weather and Meals on the shell; then the Routines chart, which needs both.
- #49 adds a Settings link for the Household Account. Once both it and the shell have landed, that link sits at the foot of the navigation rail, and a Device never sees it.
- #50 (the Wall on a phone) restructures the same shell. It is blocked on this spec's tickets so the two are not built against each other.
- Open-Meteo is free for non-commercial use and asks for attribution. If Nidus ever serves more than this Household, move the fetch behind an Edge Function with a cache.
