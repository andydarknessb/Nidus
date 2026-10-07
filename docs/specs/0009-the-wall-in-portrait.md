# Nidus v9: the Wall in portrait

Tracker: GitHub issue #161; its sub-issues are the tickets. Vocabulary: [CONTEXT.md](../../CONTEXT.md). Decisions: [PLAN.md](../PLAN.md) (v9 section). The look: [look.md](../look.md), whose section "Portrait" this spec adds. The tablet: a Lenovo Tab P12 (TB370FU), 12.7 inches, 2944 by 1840 physical pixels, 16:10, an LCD, in Fully Kiosk Browser ([fully-kiosk.md](../fully-kiosk.md)).

## Problem Statement

The Wall is drawn for a 16:10 tablet in landscape, and below 768 px wide it is a phone. The tablet on the wall is now a Lenovo Tab P12, which may hang either way. Turned upright it is about 920 to 1080 CSS px wide and 1470 to 1730 tall (the width depends on the tablet's Display size setting, which sets the device pixel ratio, near 1.7 by default and 2 one step larger). That is a tablet by the width rule, so it gets the landscape layout: five or four day columns and the right rail squeezed into the width of a column each, Week's seven columns under 110 px, and most of a tall screen empty under them. In landscape the tablet is 1470 to 1730 px wide and 920 to 1080 tall, more than the 1280 by 800 the Wall was drawn on, and nobody has checked it there.

## Solution

A tablet that is taller than it is wide is in portrait, and the Wall lays its screens out for the height it has: the days across the top of Home and Up next beside the Pinned List under them, Week as seven rows, Meals with the days as rows. The chrome does not change: the navigation rail stays at the left, the header above, the people strip under it, the mode as it is. Nothing changes in landscape, at any size, and nothing changes on a phone.

The decisions:

1. **Portrait is the tablet's second form.** At 768 px and wider, a viewport taller than it is wide is portrait, by the viewport alone: never the user agent, the device, a sensor or a per-Device setting. A window on a desktop that is taller than wide is portrait too. Below 768 px it is a phone, whatever its height.
2. **The chrome is the Wall's.** The rail at the left, the header over the screen, the people strip under the header on the calendar screens, the switch at the rail's foot, the Household's Appearance. No tabs, no gear.
3. **Home restacks.** The days across the top, as many as the width holds by the rule that already holds (four at the P12's widths), Up next and the Pinned List side by side under them.
4. **Week is seven rows.** Each day a row: its heading at the left, its events as pills that wrap to the right of it. The week scrolls as a column, with the Wall's More button at its foot, when seven rows do not fit.
5. **Meals turns.** The days as rows, the four slots as columns, the slots' names across the top.
6. **Routines and Lists wrap.** The chart's columns and the Lists screen's cards keep their landscape widths and wrap into rows, each at its natural height, and the screen scrolls as one column with the More foot, as Week does. The sideways More goes.
7. **Month, Day and the sheets keep their form.** Their columns are narrower and taller, and give way by the rules they already have (a Month line's pin gives way on a narrow line, then its title, and its discs are never shrunk or cut). What is cut or under 48 px at the P12's two portrait sizes is fixed; nothing else moves.
8. **Landscape changes nothing**, at 1280 by 800 or at the P12's 1470 to 1730 by 920 to 1080.
9. **The orientation is the kiosk's.** Fully Kiosk's Screen Orientation setting decides whether the tablet turns; the manifest asks for no orientation and the app never locks one.
10. **No new data**: no migration, no table, no column.

## User Stories

1. As a parent, I want the Wall to use the whole screen when the tablet hangs upright, so that nothing is squeezed and nothing is empty.
2. As a parent, I want Home upright to show the coming days across the top and Up next and the shopping list under them, so that the three things I look at first are all there at a glance.
3. As a parent, I want Week upright to read down the screen, one day a row, so that a tall screen shows a week of events without a column 100 px wide.
4. As a parent, I want Meals upright to read down the days, so that the week's dinners are a column I can read top to bottom.
5. As a parent, I want the rail, the clock, the switch and the people strip where they are in landscape, so that an upright Wall is still the Wall.
6. As a child, I want every tile and button to stay at least 48 px upright, so that I hit what I aim for.
7. As the owner, I want nothing about landscape to change, so that the tablet in the kitchen keeps looking as it did.
8. As the owner, I want to choose landscape or portrait in Fully Kiosk and have the Wall follow, so that the app has no setting of its own to find.

## Implementation Decisions

### The rule

- `homeLayout(width, height, rem)` in `src/lib/home-layout.ts` gains `portrait: !phone && height > width`, and `useHomeLayout` returns it as it returns `phone`, one listener, one pure function. `days` and `tiles` keep their rules: in portrait at the P12's widths the room is under 1200 px, so Home holds four days, and the height is well over 760 px, so Up next holds three tiles.
- A width of 0 is neither a phone nor portrait. A square viewport is landscape.
- The inline script in `index.html` that paints the mode before the first paint changes nothing: portrait is a tablet and paints by the Wall's rules.
- Crossing portrait (a tablet turned) swaps the layout without a reload and keeps the route, the Profile filter and what has been read, as crossing 768 px does. An open Add event sheet may close, as it does across 768 px.

### Home

- `HomeShell` (`src/WallPage.tsx`) keeps one tree: Home's grid is `calendar | rail` in landscape and `calendar / rail` in portrait, chosen by `home.portrait` on the grid's classes. The calendar takes what is left of the height; the lower row is as tall as Up next needs for its tiles.
- `HomeRail` (`src/components/HomeRail.tsx`) takes `row: boolean`: a column in landscape (Up next over the Pinned List, as now), a row in portrait (Up next at the left at its natural width, the Pinned List beside it taking the rest). In the row the Pinned List is as tall as Up next and scrolls with its More foot (Overflow), as it does in the column; a long list never pushes the calendar up.
- Up next in the row is as wide as its tiles want, no more than half the row. The width it has now in the rail (20 rem) is its width in the row.

### Week

- `PagedCalendar` (`src/components/FiveDayCalendar.tsx`) renders Week as rows when `home.portrait`, through the `useHomeLayout` it can read or a `portrait` prop from `HomeShell`; one read of the window, not two.
- A row (`src/components/Schedule.tsx`, a new `rows` form beside the columns): the day's heading at the left, the same heading as the column's (weekday, the date in its disc when it is today, the weather line when the Household has a place), in a 9.6 rem column, and the day's pills to its right in a row that wraps, 8 px apart, each pill 220 px wide (the Day view's Earlier and Later rows' pill) and at least 52 tall, in time order. An empty day says nothing, as an empty column does. Today's row has the `--muted` ground, as today's column has.
- The rows are `min-content` tall, under one another 12 apart, in the card the columns fill now, and the card scrolls as a column with the More foot (`useOverflow`, the same button and fade the columns have) when the seven rows do not fit. The Profile filter applies as it does to the columns.
- The Week heading row (the title and the paging buttons) does not change. Day and Month do not change.

### Meals

- `MealsScreen` (`src/MealsPage.tsx`) in portrait transposes its grid: the first row is the slots' names (Breakfast, Lunch, Dinner, Snack, each with its icon), the first column is the days (the same heading as now: the weekday and the date, today in its disc), and a cell is the same button as now, at least 48 px tall and never narrower than 3 rem. The rows share the height, as the columns share the width now.
- Tapping a cell opens the meal sheet for that day and slot, as now. The paging row does not change.

### The other screens

- Month: the grid keeps seven columns. At the P12's narrow width a Month line shows its time, its discs and what is left of its title, by the line's rule; on a line too narrow for its pin, its time and its discs (a container query on the line, so larger text gets the same) the pin gives way first and the time's end last, and a disc is never cut (`src/components/MonthCell.tsx`).
- Day: one column, unchanged.
- Routines and Lists (`src/RoutinesPage.tsx`, `src/SharedListsPage.tsx`): in portrait the row of people's columns and the row of list cards wrap (`flex-wrap`), as many to a row as fit at their landscape widths (a column at least 17 rem and at most `max-w-md`, a card at least 17 rem), the rows 16 apart. A column or a card is its natural height, with no More foot of its own, and the chart or the screen scrolls as one column with the shared More foot named "routines" or "lists". The heading row's sideways More is not drawn. Landscape is unchanged class for class. Ticket #168.
- Sheets: the Add event sheet is one column below 960 px wide and two from it, as now; a portrait P12 is on either side of that line depending on its Display size, and both are right. Every other sheet is the same card on the scrim.
- At 920 by 1472 and 1082 by 1732, in both modes, every screen is checked by eye and by measure: nothing cut, nothing under 48 px, nothing under the 14 px floor. What is found is fixed in the ticket that finds it.

### Landscape and the tablet

- At 1472 by 920 and 1732 by 1082 (the P12 with its Display size one step larger, and at the default) Home holds five days and three tiles by the existing rule, and nothing moves. `tests/home-layout.test.ts` says so at those four sizes.
- `docs/fully-kiosk.md` drops "has no portrait form" and gains the P12's set-up: Screen Orientation as the household likes it, Display size left at the default, Font size for larger text (`docs/look.md`, "Larger text").
- The display is an LCD, so dark mode at night costs nothing and burn-in is no concern; the panel's own brightness, screen-off and screensaver stay Fully Kiosk's, as before.

### Testing Decisions

- Pure, with unit tests: `homeLayout` at 920 by 1472, 1082 by 1732, 1472 by 920, 1732 by 1082, 768 by 1024 (portrait), 767 by 1024 (a phone, not portrait), 1000 by 1000 (landscape) and 0 by 0 (neither).
- Through `renderToStaticMarkup`, as the phone's tests do: Home's grid classes in portrait and in landscape; `HomeRail` as a row and as a column; Week's rows (seven, each with its heading and its day's pills, today's ground, an empty day silent); Meals' transposed grid (the slots across the top, the days down the side, a cell's name unchanged).
- Nothing new through the data seam: no new query. The existing tests pass unchanged.
- Screens are checked at 920 by 1472 and 1082 by 1732 in both modes, and at 1280 by 800, 1472 by 920 and 1732 by 1082 to see nothing moved.

## Out of Scope

- A phone on its side wider than 768 px is still the tablet layout (0004, decision 8), and in landscape by this rule, since it is wider than tall.
- A portrait form for Month or Day beyond what their rules give.
- Any change to `/settings`, to the phone layout, or to the mode rules.
- Locking the orientation from the app, or a per-Device orientation setting.
- Swiping between days or weeks.

## Further Notes

- The CSS px sizes above are from the P12's 273 ppi and Android's density rule (a device pixel ratio near 1.7 at the default Display size, and 2 one step larger); nobody has read `innerWidth` on the tablet itself. The rules are by width and height, never by those numbers, so a different ratio changes nothing but which side of 960 px the Add event sheet is on.
- In portrait the tablet is 16:10 turned on its side, 10:16; nothing in this spec is tied to that ratio either.
