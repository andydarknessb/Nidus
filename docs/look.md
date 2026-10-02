# The look

One look in two modes: light by day, dark at night. This file is the source for colour, type, shape and the shared parts. The spec that introduced it is [0003](specs/0003-the-look.md). The values live in code in `src/lib/look.ts` and `src/index.css`, and `tests/look.test.ts` holds every pair below to its floor.

## Principles

- **The chrome is neutral. Colour belongs to people.** The only hues on a screen are the Profiles' own. The whole Household and Meals share one warm neutral, never a Profile colour. Delete is the only red.
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
| `--input` | field outlines and empty rings | `#667085` | `#7C8499` |
| `--foreground` | words | `#182031` | `#F5F2EA` |
| `--muted-foreground` | secondary words, never dimmer | `#384256` | `#C3C7D4` |
| `--ink` | words on a person's stored colour | `#182031` | `#111318` |
| `--primary` | the one primary action, today's disc | `#182031` | `#F5F2EA` |
| `--primary-foreground` | words on it | `#FFFFFF` | `#111318` |
| `--destructive` | delete | `#991B1B` | `#991B1B` |
| `--destructive-foreground` | words on it | `#FFFFFF` | `#F5F2EA` |
| `--everyone` | whole-Household events, Meals | `#EEE6D8` | `#3A342C` |
| `--ring` | the focus ring, 2 px, offset 2 px | `#182031` | `#F5F2EA` |
| `--scrim` | behind a sheet | `rgb(24 32 49 / 50%)` | `rgb(0 0 0 / 60%)` |

`--secondary` (the secondary button's fill) is `--muted`, and `--popover` is `--card`.

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

What each role is, by mode:

| Role | Used for | Light | Dark |
| --- | --- | --- | --- |
| soft | behind a person's things: a Routines column, a people pill | 100 | 300 mixed 13% into `--card` |
| fill | an event, the picture disc on a to-do tile | 200 | 300 mixed 28% into `--card` |
| base | a finished tile | 300 | 300 |
| on base | words on a finished tile | `--ink` | `--ink` |
| strong | the initial disc, pictures, rings, progress | 800 | 300 |
| on strong | the initial | white | `--ink` |
| tick | the tick on a finished tile | white on 800 | 300 on `--ink` |
| done picture | the picture disc on a finished tile | 800 on 100 | `--ink` on 300 darkened 20% |

Words on a soft or a fill are always `--foreground` (soft also takes `--muted-foreground`). Words are never drawn in a person's colour.

An event for one person is that person's fill. A shared event is striped, one equal band for each person, left to right in Profile order. An event for the whole Household is `--everyone` with the house disc.

## Type

Two faces, shipped with the app: **Young Serif** (one weight, 400) for the clock, dates, names and titles, and **Lexend** (400, 500, 600) for everything else. The clock's digits sit in fixed-width cells so the time never shifts.

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

## Shape and space

Cards 24, tiles and fields 16 to 18, rows and event pills 14, pills and discs round. Spacing steps 4, 6, 8, 12, 16, 24. No shadows, no gradients (a shared event's stripes are flat bands), no coloured side borders.

## The parts

- **Buttons.** Four voices from one component: primary (`--primary`), secondary (`--muted`), quiet (no fill, `--muted-foreground`) and delete (`--destructive`). One primary on a screen. Pressed dips and takes `--accent`. Switched off is 40% and not tappable.
- **Selected.** `--accent` fill, a 2 px inset ring in `--foreground`, weight 600: the current rail entry, a pressed pill, a segmented control's choice, the current tab.
- **A field.** `--muted` fill with a 1.5 px inset `--input` ring, its label above it, 52 to 60 tall. Focused, the ring is 2.5 px of `--foreground`. A placeholder is `--muted-foreground`.
- **A person.** A disc in their strong colour with their initial, at 24, 34, 40, 44 or 56 px. Everyone is the same disc in `--primary` with a house.
- **An event pill.** At least 52 tall, radius 14, the title on up to two lines (it wraps between words and never inside one, then ends in an ellipsis), the time under it, the initial disc at the right. The event that is on now has a 2.5 px inset ring.
- **Today.** The date in a `--primary` disc, on every view.
- **A Routine tile.** 80 tall, radius 18: the picture in a 52 px disc, the words, then a 44 px ring. To do, the tile is `--card` and the ring is the person's strong colour. Done, the tile is the person's base colour with a tick; the words stay as they are, not struck through.
- **Progress.** One pip for each Routine: filled in the person's strong colour, or an outline.
- **The people strip.** Everyone, then a pill for each Profile on its soft colour: the disc, the name, "3 of 5" and the pips. Pressed, a pill filters the calendar.
