# Nidus v4: the Wall on a phone

Tracker: GitHub issue #107; its sub-issues are the tickets. It supersedes the fleet's #50, which asked for three tabs and an agenda; the drawings the owner approved ask for more. Vocabulary: [CONTEXT.md](../../CONTEXT.md). Decisions: [PLAN.md](../PLAN.md) (v4 section). The look: [look.md](../look.md), whose section "The phone" this spec adds. The drawings: the design canvas's row "Proposed: the Wall on a phone, below 768 px wide", light and dark, nine screens each, approved by the owner on 2026-10-06.

## Problem Statement

The Wall is drawn for a 16:10 tablet in landscape. On a phone the navigation rail, the five day columns and the right rail do not fit: the owner opened the deploy preview on his phone, found nothing he could use and could not find the light and dark switch. Only `/settings` is made for a phone. The family wants to look at the calendar, tick a Routine and add to the shopping list from their phones, which already sign in as the Household Account.

## Solution

Below 768 px of viewport width the Wall becomes a phone app: the same screens, the same data and the same rules, one column at a time, with five tabs at the foot instead of the rail. At 768 px and wider nothing changes.

The eight decisions the owner approved:

1. Five tabs at the foot: Home, Calendar, Routines, Meals, Lists. Calendar holds Day, Week and Month behind one control. Add event is a round button above the bar. Settings is a gear in the header, for the owner.
2. No clock in the header (the phone has one): the date, the weather, the gear.
3. The phone layout follows the phone's own light or dark setting. No switch.
4. Home is one column that scrolls: today's schedule, Up next, the Pinned List.
5. Week and Meals show one day at a time, picked from seven day chips. Month keeps its grid with dots for people and lists the picked day under it.
6. Routines shows one person at a time, picked from a row of people with their progress. Lists shows one list at a time.
7. Rows that scroll sideways (people, days, lists) are cut at the edge as the sign; on a phone a swipe is expected.
8. Sheets rise from the foot. At 768 px and wider nothing changes.

## User Stories

### The shell

1. As a parent on my phone, I want the Wall to fit my screen, so that I can check the family's day away from the kitchen.
2. As a parent, I want five tabs at the foot of the screen, so that every part of the Wall is one tap from my thumb.
3. As a parent, I want Add event as a round button above the tabs, so that adding is always one tap away.
4. As the owner, I want a gear in the header that opens Settings, so that I can still reach administration from the Wall.
5. As a family member on a tablet that is paired as a Device, I want no gear, so that nothing only the owner may do is offered to me.
6. As a parent, I want the header to show the date, the weather and whether the Wall is offline or behind with Google, and no clock, so that the header is short and my phone's own clock is not repeated.
7. As a parent, I want the phone layout light or dark as my phone is, so that it matches every other app I use and never flashes the other mode when it opens.

### Home and the calendar

8. As a parent, I want Home to be today's schedule, then Up next, then the Pinned List, in one column I scroll, so that the tablet's Home reads on a phone.
9. As a parent, I want the people strip to scroll sideways under my finger and to filter the calendar as it does on the tablet, so that I can see only my events.
10. As a parent, I want Calendar to offer Day, Week and Month, so that I can look ahead as I do on the tablet.
11. As a parent, I want Week to show one day at a time, picked from seven day chips, so that each day's events are readable at phone width.
12. As a parent, I want Month to keep its grid with a dot for each person who has something that day, and to list the day I pick under it, so that I can scan the month and then read a day.
13. As a parent, I want to tap an event to see its details in a sheet that rises from the foot, and to change or delete a Native Event there, so that the phone does everything the tablet does with events.

### Routines, Meals and Lists

14. As a child using a parent's phone, I want to see one person's Routines at a time with big tiles, so that I tick my own and not my brother's.
15. As a parent, I want a row of people with each one's progress above the Routines, so that I see who is behind without opening each one.
16. As a parent, I want Meals to show one day's four meals at a time, picked from seven day chips, so that I can plan the week on my phone.
17. As a parent, I want Lists to show one list at a time, picked from a row of lists with the Pinned List first, so that the shopping list is the first thing I see in the shop.
18. As a parent, I want to add an item and cross one off on my phone, so that the list on the Wall is right when I get home.

### Accessibility

19. As a family member with poor eyesight, I want every word on the phone layout to hold the same AAA contrast as the tablet in both modes, so that the small screen is not the hard one to read.
20. As a family member, I want every control on the phone to be at least 48 px, so that I hit what I aim for with a thumb.
21. As a screen reader user, I want the tabs, chips and sheets named and marked current or pressed, so that I know where I am.

## Implementation Decisions

### Choosing the layout

- The layout is chosen by viewport width alone, never by user agent, device kind or a per-Device setting. `src/lib/home-layout.ts` already tracks the window's size for Home; `homeLayout(width, height)` gains `phone: width < 768`, and `useHomeLayout` returns it. One listener, one pure function.
- `HomeShell` keeps every piece of shared state where it is (the route, the Household read, the forecast, the Profiles, the Profile filter, today's Routines, the Add event sheet) and only its chrome branches: `phone ? <PhoneShell …> : <the existing grid>`. No reader, query or subscription is added or duplicated for the phone, and none changes for the tablet.
- `PhoneShell` (`src/components/PhoneShell.tsx`) draws the header, the screen in one scrolling column, the Add event button and the tab bar. The screen for each route is chosen in `src/PhoneWall.tsx`, one branch per route, each a phone screen under `src/phone/`. Until a screen's ticket lands, its branch renders the tablet's component, so the shell ticket ships a working app.
- Crossing 768 px (a window resized, a tablet turned) swaps the layout without a reload and keeps the route, the Profile filter and an open sheet's inputs where React can keep them; an open Add event sheet may close.

### The shell

- **Tabs**: a `nav` named "Wall sections" fixed at the foot, five equal buttons 56 px tall with an icon over a word: Home (`/`), Calendar (Day, Week and Month), Routines, Meals, Lists. The current one has `aria-current="page"`, the selected fill and a ring, as the rail's. Calendar is current on Day, Week and Month and opens Week, on the date `navigationRailDate` gives, as the rail does. The bar keeps the phone's bottom safe area (`env(safe-area-inset-bottom)`) clear.
- **Add event**: a 56 px round primary button, bottom right, 16 px above the bar, named "Add event", on every tab, for the Household Account and for a Device. It opens the existing Native Event sheet on the date `wallDate` gives.
- **Header**: one row, 56 px: the Household's name (13 px, secondary) over the date (Young Serif 26 px), then the weather now, then Offline and stale sync as the tablet's small pills, then the gear. The name and then the date give way first. No clock and no next-meal button (Meals is a tab).
- **Gear**: shown only to the Household Account, 48 px, named "Settings", going where the rail's Settings link goes, the same way.
- **The column**: the document scrolls, not a box inside it, so the phone's own gestures work. It has 16 px gutters and enough padding at its foot that nothing ends under the bar or the Add event button.
- **Status line**: overlays the foot of the column above the bar.
- **Mode**: on the phone layout the mode follows `prefers-color-scheme`, light when it says nothing, and changes when it does, as `/settings` already does (`useSystemMode`). It neither reads nor writes the Wall's stored mode or the switch's override, and there is no switch. The Household's Appearance governs Walls of 768 px and wider only. The inline script in `index.html` that sets `data-mode` before the first paint takes the same rule: below 768 px it paints by `prefers-color-scheme`.

### Screens

- **Rows that scroll sideways** (the people strip, Routines' people, the list chips): one line, `overflow-x: auto`, no visible scroll bar, items at their natural width so the last one is cut at the edge. Each item is a real button reachable by Tab; focus brings it into view. No swipe handler: the browser's own scrolling is the gesture.
- **Home**: the people strip (its pills shrunk to disc, name and pips, 132 px wide, Everyone first), then a Today card (today's disc, "Today", the day's high and low, then today's events as the tablet's stacked pills), then Up next with its "N more" link to Routines, then the Pinned List card with its add row, its items and "All lists". Up next shows up to three tiles, as on a tablet.
- **Calendar**: the people strip, then a control of three, "Day", "Week", "Month" (`aria-pressed`, 52 px), which changes the route as the rail's entries do, then a pager row (Previous and Next as 48 px round buttons named for what they move by, the period's words between them).
  - **Week**: a card with seven day chips (weekday over date; today in the filled disc and named "today"; the picked one has the selected fill and ring), the picked day's full date as a heading, and that day's events as stacked pills. The picked day is today when the week holds it, else the week's Sunday; it is the screen's own state, not part of the address. Tapping an event opens its details as on the tablet.
  - **Day**: the tablet's Day view in one column: the Earlier row, the hour grid at 48 px an hour, the now line, the Later row.
  - **Month**: the weekday initials, then the grid: each cell is the date and up to three dots, one for each person who has an event that day in their strong colour and one in `--primary` for the whole Household, in the order of the people strip. A cell is a button named with its full date and how many events it has ("Friday, October 2, 4 events"), so the dots are never the only telling. Today has the filled disc; the picked day the selected fill and ring. Under the grid, the picked day's heading and its events as stacked pills. The picked day starts as today when the month holds it, else the 1st.
  - The Profile filter applies to every one of them, dots included.
- **Routines**: a row of people (disc, name, "3 of 5" or "All done", the selected ring on the picked one), then the tablet's part-of-day control (Morning, Afternoon, Evening, Whole day, opening on the part it is now), then the picked person's card in their soft colour: their disc and name, their progress, then their tiles under the part's heading, what is left from earlier, and how many are done. The picked person starts as the first in the people strip's order with something left now, else the first. Ticking and unticking are the tablet's, through the same reader.
- **Meals**: the pager by week, then a card with the seven day chips, the picked day's heading and its four slots (Breakfast, Lunch, Dinner, Snack) as 68 px rows: the slot's icon, the slot's name over the meal or "Add a meal". Tapping a row opens the existing meal sheet for that day and slot. The picked day follows Week's rule.
- **Lists**: a row of list chips (the Pinned List first with its pin, each with "N to get"), then the picked list's card: its name, the add row, its items, "Clear N crossed off". The Pinned List is picked first. Everything else about lists (adding, crossing off, clearing, creating, renaming, deleting) is the tablet's.

### Sheets

- Below 768 px every sheet rises from the foot: full width, top corners 24 px, square at the foot, at most the height of the screen less 24 px, a 40 by 4 px handle drawn at its top (decorative, `aria-hidden`), its body scrolling, its foot clear of the phone's safe area, over the scrim. That is the shared `Sheet` (`src/components/Sheet.tsx`) and the two dialogs that draw their own frame, the Native Event sheet and the meal sheet. Focus, Escape, the scrim's tap and `inert` behind are unchanged.
- The Native Event sheet's one-column form below 960 px already fits; at phone width its fields and buttons keep 48 px and nothing scrolls sideways.
- No slide animation: a sheet appears, as on the tablet.

### At 768 px and wider

- Nothing changes. Every existing test passes unchanged, and the 1280 by 800 Wall is the same.

### Testing Decisions

- Tests run as they do now: Vitest in the `node` environment, components through `renderToStaticMarkup`, data through the local Supabase stack as a real principal. No new test tooling.
- Pure, with unit tests: `homeLayout` at 767 and 768 px; the picked day of a week and of a month (today inside and outside the period, across Household midnight and a DST change, in the Household Timezone and never the machine's); the Month dots (up to three, people-strip order, the Household's dot, the filter applied); the Routines tab's first pick.
- Through `renderToStaticMarkup`: the tab bar (five tabs, the current one marked, Calendar current on Day, Week and Month), the header (the gear for the Household Account and not for a Device, no clock), a day chip and a Month cell's names, a sheet's phone frame.
- No new query. If one becomes needed it is tested through the seam like every other.
- Screens are checked by eye at 390 by 844 in both modes and at 1280 by 800 to see nothing moved, with a dev server on the local stack.

## Out of Scope

- A phone on its side wider than 768 px gets the tablet layout, as decision 8 says. If that proves cramped, a height rule is a follow-up.
- Swiping between days, weeks or tabs.
- Changes to `/settings`, which is already a phone page.
- An installable app prompt, push notifications, offline writes.
- New data: no migration, no table, no column.

## Further Notes

- #50's acceptance criteria that still hold are carried here: the layout chosen by width alone with a 767 against 768 px test, every Device capability on the phone and nothing only the Household Account may do, the stale-sync badge, Realtime refetch, the offline badge and Household midnight carrying over, PLAN.md updated. Its three tabs and five-day agenda are replaced by the approved drawings. It closes with this spec.
- The drawings are the reference for sizes; `docs/look.md` "The phone" writes them down.
