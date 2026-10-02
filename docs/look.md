# The look

One look in two modes: light by day, dark at night. This file is the source for colour, type, shape and the shared parts. The spec that introduced it is [0003](specs/0003-the-look.md). The values live in code in `src/lib/look.ts` and `src/index.css`, and `tests/look.test.ts` holds every pair below to its floor.

## Principles

- **The chrome is neutral. Colour belongs to people.** The only hues on a screen are the Profiles' own. The whole Household and Meals share one warm neutral, never a Profile colour. Delete is the only red in the chrome.
- **Never colour alone.** A person is a disc with their initial. Today is a filled disc. Selected is a fill and a ring. Done is a fill and a tick.
- **Surfaces are told apart by fill, not by an outline.** Outlines are for fields and empty rings.
- **AAA in both modes.** Words on their ground are 7:1 or better. A shape that carries meaning (a ring, an outline, a picture, a progress pip) is 3:1 or better.
- **Sized for the room, then for the hand.** The clock and the date are read from across the room. Everything else is read at arm's length and is never under 14 px.
- **Touch.** Anything tappable is at least 48 px in both directions and 8 px from its neighbour, 56 for a main action, 80 for a tile a child taps.

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
| Screen titles, a person's name | Young Serif | 26 to 30 |
| Card titles, day numbers | Young Serif | 22 to 28 |
| A Routine's words, tile labels | Lexend 500 | 19 |
| List items, fields | Lexend 400 | 17 |
| Event titles, buttons | Lexend 600 | 15 to 16 |
| Times, captions, rail words | Lexend 400 to 500 | 14, the smallest |

An initial inside a disc (and the "+N" of the 16 px disc) is the one exception to the 14 px floor: it is never under 11 px.

## Shape and space

Cards 24, tiles and fields 16 to 18, rows and event pills 14, pills and discs round. Spacing steps 4, 6, 8, 12, 16, 24. No shadows, no gradients (a shared event's stripes are flat bands), no coloured side borders.

## The parts

- **Buttons.** Four voices from one component: primary (`--primary`), secondary (`--muted`), quiet (no fill, `--muted-foreground`) and delete (`--destructive`). One primary on a screen. Pressed, a button dips; secondary and quiet also take `--accent`, and primary and delete keep their fill so their words keep their contrast. Switched off is 40% and not tappable.
- **Selected.** `--accent` fill, a 2 px inset ring in `--foreground`, weight 600: the current rail entry, a pressed pill, a segmented control's choice, the current tab.
- **Focus.** A 2 px ring in `--ring`, offset 2 px, on every control. A field instead thickens its own ring to 2.5 px of `--foreground`.
- **A field.** `--muted` fill with a 1.5 px inset `--input` ring, its label above it, 52 to 60 tall. A placeholder is `--muted-foreground`.
- **A person.** A disc in their strong colour with their initial, at 16, 24, 34, 40, 44 or 56 px. The 16 px disc is for the end of a Month line, and its initial is 11 px, the smallest an initial may be. Everyone is the same disc in `--primary` with a house.
- **An event pill.** At least 52 tall, radius 14. The title has the whole width of the pill, on up to two lines (it wraps between words and never inside one, then ends in an ellipsis). Under it is one row: the time at the left and who it is for at the right, centred on each other; when the time's words and the discs do not fit together the row wraps and the discs keep to the right, so nothing is clipped or overlapped. A Native Event has a pin before its title. One Profile is a disc, two are two discs, and three or more are the first one's disc and a "+N" disc that counts the rest (three people are a disc and "+2"), so the discs are never more than two wide. Discs overlap by 4 px with a ring in `--card` between them, so each initial stays readable. A timed event that is on now has a 2.5 px inset ring in `--foreground`, drawn over the fill; a pill that says "All day" never has it, a timed event that covers all of today included.
- **A Month line.** One event on a day of the Month grid: 22 tall, radius 10, filled as the pill is (one Profile's fill, equal bands for two or three, `--everyone` for the whole Household), its words `--foreground`, and one line. In it: the pin of a Native Event, the time (14, with no ":00" on the hour, and none for an all-day event or one that began on an earlier day), the title, which takes the room that is left and ends in an ellipsis (it starts where it is written from, so a right-to-left title is cut at its end), and at the end who it is for, by the pill's rule: one Profile is a disc, two are two discs, three or more are the first one's disc and a "+N" disc, and the whole Household is the house. These discs are 16 px with an 11 px initial and overlap by 3 px with a 1 px ring in `--card` between them. They never shrink; the title gives way. Colour alone does not say whose an event is, since two people can share a colour to the eye and four of five draw the same three bands as three.
- **Today.** The date in a `--primary` disc, on every view: 38 px with a 21 px number on the schedule, and 34 px with a 20 px number in a Month cell, where the other dates are 22 px.
- **The now line.** `--foreground`, behind the Day view's blocks.
- **The Day view.** An hour is 3 rem (48 px), so an hour-long event is exactly one hour tall and no block is under one. A block is the event pill's fill and discs on one line (the title, the time, "On now" when it is, the discs), radius 14, 2 px short of its end where it is longer than an hour so events that follow each other show a gap. The row above the grid holds the all-day events and then what ended before it, the row below what starts after it, each a 52 tall row of 220 wide pills with one line of title, always in its place and scrolling sideways. Events that overlap share two lanes, 8 px apart; a third and more in a cluster are one 48 wide tile at the right of the second lane, `--card` with a 1.5 px `--input` ring and "+N" in it, which opens a list of the cluster. Today's title is the date in a 38 px `--primary` disc, the word "Today", then the date in words.
- **A sheet.** A card, 28 round, on the scrim, its title in Young Serif at 30 and a quiet round Close at the top right: the Add event sheet, an event's details and the list a "+N" opens. The details say who the event is for on the event's own fill with its discs and every name ("Everyone" for the whole Household), and where it lives.
- **A Routine tile.** The whole tile is the button, 80 tall, radius 18: the picture in a 52 px disc, the words, then a 44 px ring. To do, the tile is `--card` and the ring is the person's strong colour. Done, the tile is the person's base colour with a tick; the words stay as they are, not struck through.
- **Progress.** One pip for each Routine: filled in the person's strong colour, or a 1.5 px `--input` ring. Past eight, the count alone.
- **The people strip.** Everyone, then a pill for each Profile on its soft colour: the disc, the name, "3 of 5" and the pips. Pressed, a pill filters the calendar: Everyone takes the Selected look, and a person's pill keeps its soft colour, takes the ring and shows a tick in place of the initial. A pill too narrow for the count and the pips (under about 166 px) shrinks to its disc and name, and past that the row scrolls sideways beside a "More people" button.
- **The status line.** One line at the foot of the screen that says what just happened, for six seconds.
- **Beyond the calendar's range.** A hatch in `--input`.

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
