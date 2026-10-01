# Nidus v2 — closing the gaps with Skylight Calendar

Tracker: GitHub issue #53; its sub-issues (#54 to #60) are the tickets. Vocabulary: [CONTEXT.md](../../CONTEXT.md). Decisions: [PLAN.md](../PLAN.md) (v2 section), ADR [0001](../adr/0001-supabase-over-custom-backend.md), ADR [0002](../adr/0002-read-only-calendar-mirror.md). Research: [skylight-comparison.md](../skylight-comparison.md).

## Problem Statement

Skylight Calendar is the commercial product Nidus stands in for. Compared feature by feature (`docs/skylight-comparison.md`), the Wall is behind it in ways the family meets every day. It shows no clock, date or weather. It has no month view. On a busy week nobody can pick out one person's events. Routines are a flat list: no morning or evening, no sense of progress, nothing that marks finishing them, and a Routine cannot be edited once made. There is nowhere to write what is for dinner. And the views the Wall does have hang off a row of header buttons with no room for another.

## Solution

The Wall gets a shell that can hold more: a navigation rail down the left side and a header that carries the Household's name, the time and date, the weather and a chip per Profile for filtering the calendar. On that shell it gains a month view, a full-screen Routines chart with progress and a small celebration when someone finishes, Routines grouped by time of day and editable from the phone, and a plain meal plan for the week. Everything stays inside the two load-bearing decisions: Supabase is the whole backend, and Google is mirrored read-only.

## User Stories

### Shell

1. As a family member, I want the time and date on the Wall, so that the calendar on the wall is also the clock on the wall.
2. As a family member, I want one fixed place to move between Home, Day, Week, Month, Routines, Meals and Lists, so that I never hunt for a button.
3. As a family member, I want the section I am on marked in the rail, so that I know where I am.
4. As a family member, I want to tap a day's heading to open that day, so that a busy Saturday is one tap away.
5. As a family member, I want the five day columns to stay as readable as they are today, so that the rail does not cost me the calendar.

### Month view

6. As a family member, I want a month view, so that I can see what the weeks ahead look like at a glance.
7. As a family member, I want each day to show its first few events in their colours and how many more there are, so that a full day reads as full.
8. As a family member, I want to tap a day in the month to open that day, so that the month is a way in, not a dead end.
9. As a family member, I want to page between months as far as the mirror goes, so that the month view never shows an empty month that only looks empty.

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
28. As a family member, I want the Wall to keep working when the weather cannot be fetched, so that a weather outage never costs me the calendar.

## Implementation Decisions

- **Shell**: the Wall is a navigation rail, a header and a screen. The rail lists Home (`/`), Day (`/day`), Week (`/week`), Month (`/month`), Routines (`/routines`), Meals (`/meals`) and Lists (the existing full-screen Lists screen, opened in place). Each entry is an icon over a word, at least 64 px square, with `aria-current="page"` on the current one and a mark that is not colour alone. Entries appear as their screens land; a ticket never ships a rail entry that leads nowhere. Paging stays with `pushState`, as today.
- **Rail and dates**: Day, Week and Month in the rail keep the date the Wall is on. From Home they open today's page. From a paged view they open the page that holds that view's date, except that Day opens today whenever the page being left contains today.
- **Header**: the Household's name, the clock and date in the Household Timezone, the weather, the Profile chips, the connection and stale-sync badges, and Add event. Chips and Add event show on the calendar screens only (Home, Day, Week, Month). The Week and Day header buttons, the paged views' Home button and their Day/Week toggle go: the rail replaces them.
- **Room**: the rail must not cost the calendar its width. Page padding and gaps drop to 1 rem and the right rail to 22 rem, so at 1280×800 the five day columns stay within a few pixels of today's width and nothing scrolls sideways.
- **Occurrences are read in one place**: a `useOccurrences` hook reads the occurrences for a span of days (the timer, the retry, the change feed). Every calendar view reads through it, so the Profile filter is applied once, inside it.
- **Month view**: `/month?date=YYYY-MM-DD`, anchored on the first of the month. A Sunday-to-Saturday grid of the weeks that touch the month, days outside it dimmed. Each day is one button that opens its Day view and shows the date, then its occurrences one line each (colour edge, start time for a timed one, title), all-day first, then by start, with "+N more" when they do not fit. Events are not tappable in the month; the day is. Paging runs inside the mirror's window (one month back, six ahead) and says so at either end, as the week view does.
- **Profile filter**: a toggle chip per Profile in the header (none when the Household has fewer than two Profiles). With none pressed the Wall shows everything. With any pressed, calendar views show the occurrences attributed to a pressed Profile and every whole-Household occurrence. A "Show everyone" button appears while a filter is on, and the filter clears itself two minutes after the last chip tap. The filter belongs to the screen: it is not saved and not shared between Devices. Routines, Lists and Meals ignore it.
- **Routine time of day**: `routines.time_of_day`, one of `morning`, `afternoon`, `evening`, or null for any time. The Wall groups a Profile's Routines under Morning, Afternoon, Evening and Any time, in that order, showing only the groups that have a Routine today, and no group headings at all when every one of that Profile's Routines today is Any time.
- **Editing a Routine**: the phone's Routines page edits title, days and time of day in place. The update grant already covers title and days; the migration adds the new column to the insert and update grants. Still Household Account only.
- **Routines chart**: `/routines`, a column per Profile that has Routines today, in the Profiles' order, each with its name, colour, "2 of 5" and a progress bar, then the same tickable Routines as the rail, grouped the same way. The rail on Home gains the count and a thin bar per Profile. The chart and the rail share one reader hook.
- **Celebration**: when a tap on this screen completes the last unticked Routine a Profile has today, a short confetti-style burst plays over that Profile's group (CSS only, under two seconds, no new dependency) and the heading reads "All done" with an icon for as long as it is true. Loading a finished list, or hearing a tick from another screen, plays nothing. Under `prefers-reduced-motion: reduce` there is no animation, only the words.
- **Meals**: a `meals` table: `household_id`, `meal_date` (a Household date), `slot` (`breakfast`, `lunch`, `dinner`, `snack`), `title` (1 to 200 characters), unique per Household, date and slot. Both principals read and write their own Household's Meals, a Device included: a Meal is free text on the Wall, the same trust as a list item. One RPC, `set_meal(date, slot, title)`, upserts, and a blank title clears. The table joins the Realtime publication and the change feed.
- **Meals screen**: `/meals?date=`, a week (Sunday to Saturday) by slot grid, paged like the week view. Each cell is a button showing the Meal or an invitation to add one; tapping opens a small sheet with one text field, Save, Clear and Cancel. Home shows a "Today's meals" card above the Routines rail, listing the slots that are planned, and nothing when none is.
- **Weather**: the Household gains `weather_place`, `latitude`, `longitude` (all three set or all three null, coordinates rounded to two decimals) and `temperature_unit` (`fahrenheit` by default, or `celsius`). The phone's settings search a place by name through Open-Meteo's geocoding API and save the pick; "Turn weather off" clears it. The screen itself fetches the forecast from Open-Meteo (no key, no server hop, nothing stored), every 30 minutes, asking for the Household Timezone so the daily dates are Household dates. A failed fetch keeps the last reading; with no place set nothing is shown. Settings credits "Weather data by Open-Meteo.com".
- **Weather on the Wall**: the header shows the current temperature with an icon and the condition in words, and today's high and low. Day headings on Home, Day and Week show that day's icon, high and low when the forecast covers the date.
- **Schema**: three additive migrations, in this order: `20261012000001_routine_time_of_day`, `20261013000001_household_weather`, `20261014000001_meals`. Each is pushed to the hosted project before the frontend that reads it is merged, so the deployed Wall never asks for a column that is not there.
- **Nothing changes in the mirror**: no Edge Function, cron job or sync behaviour is touched.

## Testing Decisions

- **Seam**: unchanged. Every new column, table and RPC is exercised through the Supabase JS client against the local stack as each principal: the Household Account, a Device, another Household's principals, and a client with no session. Tests assert what each can read and write, never which policy said no.
- **Pure logic**: unit tests for the month grid (month ends, a 23 and a 25 hour day), month paging at both ends of the window, a day cell's order and overflow count, the rail's date-keeping rule, the Profile filter, Routine grouping by time of day, progress and the "this tap finished the Profile" decision, the week of Meals by day and slot, and the forecast parser and condition words. All date logic takes the Household Timezone; a test never reads the machine's zone.
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
- The phone layout below 768 px (#50) and the Household Account on the Wall (#49): those tickets stay with spec #1.

## Further Notes

- Build order: the shell and the Routine time of day first, side by side; then Month view, Profile filter, Weather and Meals on the shell; then the Routines chart, which needs both.
- #49 adds a Settings link for the Household Account. Once both it and the shell have landed, that link sits at the foot of the rail.
- Open-Meteo is free for non-commercial use and asks for attribution. If Nidus ever serves more than this Household, move the fetch behind an Edge Function with a cache.
