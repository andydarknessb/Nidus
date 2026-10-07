# The look

One look in two modes: light by day, dark at night. This file is the source for colour, type, shape and the shared parts. The spec that introduced it is [0003](specs/0003-the-look.md). The values live in code in `src/lib/look.ts` and `src/index.css`, and `tests/look.test.ts` holds every pair below to its floor.

## Principles

- **The chrome is neutral. Colour belongs to people.** The only hues on a screen are the Profiles' own. The whole Household and Meals share one warm neutral, never a Profile colour. Delete is the only red in the chrome.
- **Never colour alone.** A person is a disc with their initial. Today is a filled disc. Selected is a fill and a ring. Done is a fill and a tick.
- **Surfaces are told apart by fill, not by an outline.** Outlines are for fields and empty rings.
- **AAA in both modes.** Words on their ground are 7:1 or better. A shape that carries meaning (a ring, an outline, a picture, a progress pip) is 3:1 or better.
- **Sized for the room, then for the hand.** The clock and the date are read from across the room. Everything else is read at arm's length and is never under 14 px.
- **Touch.** Anything tappable is at least 48 px in both directions and 8 px from its neighbour, 56 for a main action, 80 for a tile a child taps. A grid of days is the exception, where 8 px between targets would break the grid: the Wall's Month cells touch and are told apart by a hairline, as the phone's Day chips do (below), with every fill and ring drawn inside the cell.

## Modes

The Wall is light from sunrise to sunset and dark from sunset to sunrise (Auto). The round switch at the foot of the navigation rail changes it by hand until the next sunrise or sunset. The Household's Appearance (Auto, Light, Dark) is set on the phone. The phone's own pages follow the phone.

| Token | Role | Light | Dark |
| --- | --- | --- | --- |
| `--background` | the page | `#F1F4F9` | `#0E1016` |
| `--card` | cards, the navigation rail, sheets | `#FFFFFF` | `#171A22` |
| `--muted` | tiles, rows, fields, today's column | `#ECF0F6` | `#20242F` |
| `--accent` | pressed, selected, the current rail entry | `#DCE3EE` | `#2A2F3C` |
| `--border` | hairlines between rows and hours | `#DCE3EE` | `#2A2F3C` |
| `--input` | field outlines, empty rings, empty pips, the hatch | `#667085` | `#7C8499` |
| `--foreground` | words, the now line, the ring on what is on now | `#182031` | `#F5F2EA` |
| `--muted-foreground` | secondary words, never dimmer | `#384256` | `#C3C7D4` |
| `--ink` | words on a person's stored colour | `#182031` | `#111318` |
| `--primary` | the one primary action, today's disc | `#182031` | `#F5F2EA` |
| `--primary-foreground` | words on it | `#FFFFFF` | `#111318` |
| `--destructive` | delete | `#991B1B` | `#991B1B` |
| `--destructive-foreground` | words on it | `#FFFFFF` | `#F5F2EA` |
| `--everyone` | whole-Household events, Meals | `#EEE6D8` | `#3A342C` |
| `--ring` | the focus ring, 2 px, offset 2 px | `#182031` | `#F5F2EA` |
| `--scrim` | behind a sheet | `rgb(24 32 49 / 50%)` | `rgb(0 0 0 / 60%)` |

`--secondary` (the secondary button's fill) is `--muted`, `--popover` is `--card`, and each `-foreground` partner not listed is `--foreground`.

## People

A Profile stores one colour, the 300 step of its family. The look uses four steps of that family:

| Family | 100 | 200 | 300 (stored) | 800 |
| --- | --- | --- | --- | --- |
| Red | `#FEE2E2` | `#FECACA` | `#FCA5A5` | `#991B1B` |
| Orange | `#FFEDD5` | `#FED7AA` | `#FDBA74` | `#9A3412` |
| Amber | `#FEF3C7` | `#FDE68A` | `#FCD34D` | `#92400E` |
| Lime | `#ECFCCB` | `#D9F99D` | `#BEF264` | `#3F6212` |
| Emerald | `#D1FAE5` | `#A7F3D0` | `#6EE7B7` | `#065F46` |
| Cyan | `#CFFAFE` | `#A5F3FC` | `#67E8F9` | `#155E75` |
| Sky | `#E0F2FE` | `#BAE6FD` | `#7DD3FC` | `#075985` |
| Blue | `#DBEAFE` | `#BFDBFE` | `#93C5FD` | `#1E40AF` |
| Violet | `#EDE9FE` | `#DDD6FE` | `#C4B5FD` | `#5B21B6` |
| Pink | `#FCE7F3` | `#FBCFE8` | `#F9A8D4` | `#9D174D` |

What each role is, by mode. The dark mixes are `color-mix(in srgb, …)`.

| Role | Used for | Light | Dark |
| --- | --- | --- | --- |
| soft | behind a person's things: a Routines column, a people pill | 100 | 300 mixed 13% into `--card` |
| fill | an event, the picture disc on a to-do tile | 200 | 300 mixed 28% into `--card` |
| base | a finished tile | 300 | 300 |
| on base | words on a finished tile | `--ink` | `--ink` |
| strong | the initial disc, pictures, rings, progress | 800 | 300 |
| on strong | the initial | white | `--ink` |
| tick | the tick on a finished tile | white on 800 | 300 on `--ink` |
| done picture | the picture disc on a finished tile | 800 on 100 | `--ink` on the 300 with 20% `--ink` mixed in |

Words on a soft or a fill are always `--foreground` (soft also takes `--muted-foreground`). Words are never drawn in a person's colour.

An event for one person is that person's fill. A shared event is striped, one equal band for each person (three at most), left to right in Profile order. An event for the whole Household, or for every Profile in a Household of two or more, is `--everyone` with the house disc; in a Household of one Profile, an event for that Profile is theirs. A Mirrored Calendar has no colour of its own.

## Type

Two faces, shipped with the app: **Young Serif** (one weight, 400) for the clock, dates, names and titles, and **Lexend** (400, 500, 600) for everything else. Young Serif's numerals are set lining and tabular (`font-variant-numeric: lining-nums tabular-nums`) wherever it is used: its default figures are old-style, which sit low and small in a clock, and tabular figures keep the time from shifting.

| Role | Face | Size |
| --- | --- | --- |
| The clock | Young Serif | 68 |
| The date | Young Serif | 40 |
| Screen titles | Young Serif | 28 |
| A sheet's title | Young Serif | 30 |
| A person's name on the chart | Young Serif | 26 |
| Card titles, day numbers | Young Serif | 22 to 28 |
| A Routine's words, tile labels | Lexend 500 | 19 |
| List items, fields | Lexend 400 | 17 |
| Event titles, buttons | Lexend 600 | 15 to 16 |
| Times, captions, rail words | Lexend 400 to 500 | 14, the smallest |

An initial inside a disc (and the "+N" of the 16 px disc) is the one exception to the 14 px floor: it is never under 11 px.

## Shape and space

Cards 24, tiles and fields 16 to 18, rows and event pills 14, pills and discs round. Spacing steps 4, 6, 8, 12, 16, 24. No shadows, and no gradient as decoration (a shared event's stripes are flat bands). Two gradients carry meaning, and are the only ones: Overflow's fade, which says there is more below, and the hatch on days beyond the calendar's range (both below). No coloured side borders.

## The parts

- **Buttons.** Four voices from one component: primary (`--primary`), secondary (`--muted`), quiet (no fill, `--muted-foreground`) and delete (`--destructive`). One primary on a screen. Pressed, a button dips; secondary and quiet also take `--accent`, and primary and delete keep their fill so their words keep their contrast. Switched off is 40% and not tappable.
- **Selected.** `--accent` fill, a 2 px inset ring in `--foreground`, weight 600: the current rail entry, a pressed pill, a segmented control's choice, the current tab.
- **Focus.** A 2 px ring in `--ring`, offset 2 px, on every control. A field instead thickens its own ring to 2.5 px of `--foreground`.
- **A field.** `--muted` fill with a 1.5 px inset `--input` ring, its label above it, 52 to 60 tall. A placeholder is `--muted-foreground`.
- **A person.** A disc in their strong colour with their initial, at 16, 24, 34, 40, 44 or 56 px. The 16 px disc is for the end of a Month line, and its initial is 11 px, the smallest an initial may be. The initial is always Lexend, whatever face the words beside the disc are set in. Everyone is the same disc in `--primary` with a house.
- **An event pill.** At least 52 tall, radius 14. The title has the whole width of the pill, on up to two lines (it wraps between words and never inside one, then ends in an ellipsis). Under it is one row: the time at the left and who it is for at the right, centred on each other; when the time's words and the discs do not fit together the row wraps and the discs keep to the right, so nothing is clipped or overlapped. A Native Event has a pin before its title. One Profile is a disc, two are two discs, and three or more are the first one's disc and a "+N" disc that counts the rest (three people are a disc and "+2"), so the discs are never more than two wide. Discs overlap by 4 px with a ring in `--card` between them, so each initial stays readable. A timed event that is on now has a 2.5 px inset ring in `--foreground`, drawn over the fill; a pill that says "All day" never has it, a timed event that covers all of today included.
- **A Month line.** One event on a day of the Month grid: 22 tall, radius 10, filled as the pill is (one Profile's fill, equal bands for two or three, `--everyone` for the whole Household), its words `--foreground`, and one line. In it: the pin of a Native Event, the time (14, with no ":00" on the hour, and none for an all-day event or one that began on an earlier day), the title, which takes the room that is left and ends in an ellipsis (it starts where it is written from, so a right-to-left title is cut at its end), and at the end who it is for, by the pill's rule: one Profile is a disc, two are two discs, three or more are the first one's disc and a "+N" disc, and the whole Household is the house. These discs are 16 px with an 11 px initial and overlap by 3 px with a 1 px ring in `--card` between them. They never shrink. The title gives way first, down to its ellipsis (1.25 em, so a cut title always shows its ellipsis); in a cell under 7 rem wide the pin is hidden; the end of the time is cut when it must be, and a disc never. Colour alone does not say whose an event is, since two people can share a colour to the eye and four of five draw the same three bands as three.
- **Today.** The date in a `--primary` disc, on every view: 38 px with a 21 px number on the schedule and on Meals (where the other dates are 22 px), and 34 px with a 20 px number in a Month cell, where the other dates are 22 px.
- **The now line.** `--foreground`, behind the Day view's blocks.
- **The Day view.** An hour is 3 rem (48 px), so an hour-long event is exactly one hour tall and no block is under one. A block is the event pill's fill and discs on one line (the title, the time, "On now" when it is, the discs), radius 14. The block's box is its target, exactly as long as the event lasts (never under 48), and its fill and its ring are drawn 2 px short of the box's bottom, for every block: side by side, blocks and the "+N" are 8 px apart; one after another, the 48 px targets touch and the fills are 2 px apart, so two events of one person never read as one. The row above the grid holds the all-day events and then what ended before it, the row below what starts after it, each a 52 tall row of 220 wide pills with one line of title, always in its place and scrolling sideways, with a "More" button beside it when its pills do not fit (Overflow). Events that overlap share two lanes, 8 px apart. When a cluster needs more than two, the lanes go to the longest events (by how long each really lasts, not by the hour it is drawn; the earlier start first among equals, then the title) and the rest are one 48 wide tile at the right of the second lane, `--card` with a 1.5 px `--input` ring and "+N" in it, which opens a list of the whole cluster in time order. A short event never hides a long one: Nap and Snack of a quarter hour each do not push the hour's Walk behind the "+1". Today's title is the date in a 38 px `--primary` disc, the word "Today", then the date in words.
- **A sheet.** A card, 28 round, on the scrim, its title in Young Serif at 30 and a quiet round Close at the top right: the Add event sheet, an event's details and the list a "+N" opens. The details say who the event is for on the event's own fill with its discs and every name ("Everyone" for the whole Household), and where it lives. The title row and the footer stay in view whatever the sheet holds: what is between them scrolls, and says so (Overflow). While a sheet is open the page behind it is inert, out of the accessibility tree and out of reach, so a screen reader cannot swipe out of it; the sheet is drawn in the body, and the status line stays outside what is inert.
- **A Routine tile.** The whole tile is the button, 80 tall, radius 18: the picture in a 52 px disc, the words, then a 44 px ring. To do, the tile is `--card` on a person's column of the chart and `--muted` on the Up next card, and the ring is the person's strong colour. Done, the tile is the person's base colour with a tick; the words stay as they are, not struck through.
- **Progress.** One pip for each Routine: filled in the person's strong colour, or a 1.5 px `--input` ring. Past eight, the count alone.
- **The people strip.** Everyone, then a pill for each Profile on its soft colour: the disc, the name, "3 of 5" and the pips. Pressed, a pill filters the calendar: Everyone takes the Selected look, and a person's pill keeps its soft colour, takes the ring and shows a tick in place of the initial. A pill too narrow for the count and the pips (under about 176 px) shrinks to its disc and name, and past that the row scrolls sideways beside a "More people" button.
- **Overflow.** The Wall's tablet draws no scrollbars, so wherever something scrolls it says so with a button. A row that holds more than it shows has "More people" (the people strip, beside the row; the Routines chart, in its heading row), "More lists" (the Lists screen, in its heading row) or, where the row has its own word at its left end, "More" alone (the Day view's Earlier and Later rows, each beside its row, named "More earlier events" and "More later events"); it moves the row on by most of a page. A column or a card whose items scroll has a 48 px "More" at its foot, over a short fade in the colour it sits on (a gradient that carries meaning: there is more below). A sheet's body is such a column: the title row and the footer stay in view, and the body between them (an event's long notes, the list a "+N" opens, the Add event sheet's fields with a large family) has the foot, named for the sheet ("More of Piano", "Back to the top of Piano"); on the Add event sheet it is the Wall's, from 960 px wide, since the phone's one column scrolls by touch. At rest an item may sit partly under the foot. The fade is a dead band: it takes a tap and does nothing with it, so a tap just above the button never ticks the item under it, and every item is still reached by pressing More; a touch that starts on it still scrolls the list. An item that takes the focus, or is added, is scrolled clear of the foot, and the last can always be scrolled clear. The foot goes when the list fits, and the list is then back at its start. At the end the button reads "Back", with a chevron pointing back (up, for a column), and returns to the start, so it is never switched off. A press while the scroll the last one started is still running is ignored. It is a secondary button, as wide as the wider of its two labels so that it does not move when it changes, at least 48 px both ways. Its accessible name says what moves ("More of Ava's routines", "Back to the top of Groceries"). Under reduced motion it scrolls instantly.
- **A screen.** The Wall's screens (Routines, Meals, Lists, and the Day, Week and Month views) share one heading row: the title in Young Serif at 28, in a row 48 tall, with the screen's controls in it (the paging buttons beside the title on Meals and the Day, Week and Month views; the Routines chart's choice of the part of the day at the right of its title, 48 tall, its buttons 48 by 48 at least and 8 apart), and the first card 16 under the row. On Home the people strip is that row.
- **The status line.** One line at the foot of the screen that says what just happened, for six seconds. A line that wraps is balanced, so it never leaves one word alone on its last line.
- **Empty states.** What a screen says when it holds nothing, or is waiting for what it holds, in one style: 16 px in `--muted-foreground`, one sentence and, where there is something to do about it, a clause with the way out ("No lists yet. Add one on your phone."). Where there is nothing to do it is the sentence alone ("Nothing scheduled today."), and "Loading" is the waiting. A card or a screen keeps its heading when it is empty: Home's list card with no list at all still says "Lists" over its sentence. An empty day column on Home and Week says nothing. Up next holds the height of the tiles it will show (three, or two on a screen under 760 px tall) until its first read lands, so what is under it does not move when it does.
- **The pairing screen.** A tablet that is not paired is always light, whatever the hour: it holds nothing of the Household's. Its title is Young Serif at 40, and its code, under the sentence that says where to enter it, is Young Serif at 128, spaced out by letter-spacing, with the clock's lining tabular figures (no monospace face is shipped). The sentence never breaks between "sign" and "in", and the way in for the owner of the household is one line.
- **Beyond the calendar's range.** A hatch in `--input`, a gradient that carries meaning: this day is not on the calendar.

## The phone

Below 768 px of viewport width, or below 544 px of height (a phone on its side: an iPhone 15 turned is 852 by 393, and no tablet of the Wall's kind is shorter than 544, the Wall's least height; #176), the Wall is laid out for a phone ([0004](specs/0004-the-wall-on-a-phone.md)); at 768 px and wider, and 544 px and taller, it is the Wall, in landscape or in portrait (below). On a phone on its side the same column, header, tabs and sheets stand, the page scrolls more, and the column keeps 88 px clear at its right (16, Add event, 16), since the screen is too short to scroll a pager's Next or a list's plus out from under the button. The phone's styles are the `phone:` variant, which follows the document's `data-phone`, set by the one rule that lays the Wall out (never a media query), so they hold with the layout while a tablet's keyboard is up. The tokens, the type, the parts and their sizes are the same; what changes is the shell and how much a screen shows at once.

- **The mode** follows the phone's own setting (`prefers-color-scheme`), as `/settings` does. There is no switch, and the Household's Appearance is for the Wall's tablets.
- **The column.** 16 px gutters, one card under another 12 apart, cards 22 round with 12 inside. The page itself scrolls.
- **The header.** One row 56 tall, 16 under the top of the screen and 12 above the column: the Household's name (13, `--muted-foreground`) over the date (Young Serif 26), the weather now (an icon and Young Serif 22), Offline and stale sync, and for the owner a 48 px round gear on `--card`. No clock and no next meal. When the row is short of room the name gives way first, then the weather (under 420 px wide, when a pill shows); stale sync is its icon and a short "3 h", and only its icon beside a second pill; "Offline" keeps its word down to 360 px wide. Each pill's whole sentence is there for a screen reader. The date never gives way.
- **The tab bar.** Fixed at the foot on `--card` with a hairline above it, 4 between tabs and 16 under them plus the phone's safe area: five tabs (Home, Calendar, Routines, Meals, Lists), each 56 tall, an icon at 24 over its word at 14, radius 14. The current tab takes the Selected look. Every sheet stacks above the bar.
- **Add event.** A 56 px round primary button with a plus, 16 from the right edge and 16 above the bar, on every tab.
- **Rows that scroll sideways** (the people strip, Routines' people, the lists) have no "More" button: the item cut at the edge is the sign, and a swipe moves them. People strip pills are 132 wide, 52 tall, a 36 px disc, the name and the pips.
- **Day chips.** Seven to a row, sharing the width, 64 tall, radius 14: the weekday (13) over the date (Young Serif 22). Today is the word "Today" over the date in a 34 px `--primary` disc. The picked chip takes the Selected look. Seven chips 8 apart do not fit a phone, so, as in the Day view, the targets touch and the fills, rings and focus rings are drawn 2 px inside them: each chip is at least 48 wide, the row reaches the card's edges over its padding, and a row narrower than 336 px scrolls sideways. A Month row on a phone keeps the same 48 px floor.
- **A control of a few** (Day, Week, Month; Morning, Afternoon, Evening, Whole day): a 52 tall `--muted` track with 2 px inside it, its buttons 48 tall with touching targets and as wide as their words (15, on one line), the choice in the Selected look drawn 2 px inside its button.
- **The pager.** A 48 tall row: a 48 px round Previous on `--card`, the period's words in Young Serif 22 in the middle, a 48 px round Next.
- **The picked day's heading** (Week, Month, Meals) is its full date in words at 15, weight 500, `--muted-foreground`.
- **The Day view on a phone** draws a block in two rows: the title across the whole block, then the time, "On now" and the discs, which never shrink. The time gives way first; in a block that shares the width with another, "On now" is left to the ring and the block's spoken name.
- **A Month grid** on a phone is headed by the weekdays' three letters at 14 in `--muted-foreground`. **A Month cell** is a 58 tall button: the date (Young Serif 18, out-of-month dates `--muted-foreground`) over up to three 7 px dots, a person's strong colour or `--primary` for the whole Household. Its name says the date and how many events it has.
- **A sheet** rises from the foot: full width, 24 round at the top only, a 40 by 4 px handle in `--input` at its top, its foot clear of the safe area.

## Portrait

At 768 px and wider, a viewport taller than it is wide is a tablet in portrait ([0009](specs/0009-the-wall-in-portrait.md)): the Lenovo Tab P12 hung upright, about 920 to 1080 px wide and 1470 to 1730 tall. The chrome, the tokens, the type, the parts and their sizes are the same as in landscape; what changes is how five screens use the height.

- **Home.** The days across the top, as many as the width holds by the rule in "Larger text" (four at the P12's widths), and under them Up next at the left, 20 rem wide, with the Pinned List beside it taking the rest. The lower row is as tall as Up next, and never shorter than Up next with three tiles (21 rem), so it does not change height as tiles come and go; the Pinned List shows the rows that fit and says how many more ("3 more"), as it does in the column; the calendar takes the rest of the height.
- **Week.** Seven rows, one a day, 12 apart, in the card the columns fill in landscape. A row is its heading at the left (the column's heading: the weekday, the date, today's disc, the weather line) in a 9.6 rem column, then the day's pills to its right, 220 wide and at least 52 tall, 8 apart, wrapping, in time order. Today's row has the `--muted` ground. An empty day says nothing. When seven rows do not fit, the card scrolls as a column with the More foot.
- **Meals.** Turned: the slots' names across the top, the days down the side, each cell the same button, at least 48 tall and never under 3 rem wide; the rows share the height.
- **Routines and Lists.** The chart's columns (at least 17 rem, at most 28) and the Lists screen's cards (at least 17 rem) keep their landscape widths and wrap, as many to a row as fit, the rows 16 apart, each column or card its natural height with no foot of its own. The chart and the screen scroll as one column with the More foot (the foot reads "More" and is named for the routines or the lists: "More of the routines", "Back to the top of the lists"). No sideways More.
- **Everything else** keeps its landscape form, narrower and taller, and gives way by its own rule: a Month line's title gives way first, to its ellipsis; in a cell under 7 rem wide its pin is hidden; the end of its time is cut when it must be; its discs are never cut; the Add event sheet is one column below 960 px wide and two from it.
- **Landscape** changes nothing, at 1280 by 800 or at the P12's 1470 to 1730 by 920 to 1080: five days and three tiles.

## Larger text

The tablet's text size sets the root font size, and every rem in the Wall grows with it (issue #69). What is held at 130 percent (a root of 20.8 px) is that the Wall still looks like itself, and at 200 percent (32 px) that nothing is lost or out of reach.

- **Sizes are rem, minimums are px.** A box, a gap or a count that follows the text is rem, and a program that counts rows or lines measures the root font size, as the Month grid and the lists do, and never a px constant. What a finger needs (48 px, 8 px between targets, 64 px for a rail entry) is px: it does not grow with the text, so the rail's nine controls fit the height of the screen at 130 percent.
- **The Wall is at least 34 rem tall.** At 16 px that is 544 px, under every screen the Wall is for, so nothing changes there. At larger text a screen that cannot fit is that tall and the page scrolls, with the rail's foot (the switch, Settings, Add event) at the foot of the page.
- **Rails give way.** The navigation rail is 6 rem and no more than 12 percent of the screen's width, and Home's right rail 20 rem and no more than 27 percent of it, neither under what it is at 16 px.
- **Home holds less.** Judged in rem, as at 16 px: five days from 1200 px wide, else four, and three when the text is larger and the room is under 800 px; three Up next tiles from 760 px tall, else two, and one when the text is larger and the room is under 560 px.
- **A row or a heading row wraps** where it cannot fit, and the Day view's rows, the people strip, the Routines chart's columns and the Lists screen's cards scroll sideways with their "More" button, as they do at 16 px. The phone's tab bar scrolls sideways when its five words do not fit, and keeps the current tab in view.
- **A week of the Month grid** is never shorter than its date and one line under it. A list card is at least 17 rem wide.

## Routine pictures

The key stored in `routines.picture`, and the icon it draws (lucide names). Any other value, or none, draws a plain circle.

| Key | Icon | Key | Icon |
| --- | --- | --- | --- |
| `teeth` | toothbrush | `shower` | shower-head |
| `bed` | bed | `hair` | brush |
| `dressed` | shirt | `shoes` | footprints |
| `bag` | backpack | `music` | music |
| `read` | book-open | `sport` | volleyball |
| `homework` | pencil | `bike` | bike |
| `pet` | paw-print | `laundry` | washing-machine |
| `plants` | sprout | `tidy` | sparkles |
| `toys` | blocks | `medicine` | pill |
| `bins` | trash-2 | `water` | glass-water |
| `dishes` | utensils | `sleep` | moon |
| `bath` | bath | `stretch` | person-standing |
