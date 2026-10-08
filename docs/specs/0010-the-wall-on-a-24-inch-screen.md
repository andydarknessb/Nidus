# Nidus v10: the Wall on a 24-inch screen

Tracker: GitHub issue #187; its sub-issues are the tickets. Vocabulary: [CONTEXT.md](../../CONTEXT.md). Decisions: [PLAN.md](../PLAN.md) (v10 section). The look: [look.md](../look.md), whose section "A 24-inch screen" this spec adds. The screen: an Elo 2402L touch monitor (24 inches, 1920 by 1080 physical pixels, 16:9, an LCD, projected-capacitive touch), driven by a Windows PC's browser in kiosk mode ([windows-kiosk.md](../windows-kiosk.md)), hung landscape or portrait.

## Problem Statement

The Wall was drawn for a 16:10 tablet in landscape (1280 by 800), given a portrait form for the Lenovo Tab P12 in v9, and made a phone below 768 px wide or 544 px tall. The next Wall is not a tablet: a 24-inch Elo touch monitor on a PC, which the browser sees at a device pixel ratio of 1, so the viewport is the monitor's own pixels: 1920 by 1080 in landscape and 1080 by 1920 in portrait, at Windows' default 100 percent scaling. Nobody has checked a screen at those sizes, at 16:9, or at the 92 pixels per inch a 24-inch 1080p panel has (every rem is 1.75 times the size it is on the P12). Nor is there any word on the host: Fully Kiosk's settings have no counterpart on a PC, and a browser profile that forgets its storage would lose the Device's pairing on every launch.

## Solution

Nothing about the rules changes: the viewport alone decides, as settled in v4, v9 and #176, and by those rules the Elo is a Wall both ways. What this spec adds is the check of every screen at the Elo's sizes, with what is found fixed, the host's set-up in a document beside Fully Kiosk's, and the sizes and ceilings written down.

The decisions:

1. **The rules hold.** A viewport of 768 px and wider and 544 px and taller is a Wall; taller than wide is portrait. At 100 percent the Elo is 1920 by 1080 in landscape (five days and three tiles on Home) and 1080 by 1920 in portrait (four days and three tiles, within 2 px of the P12's default portrait width). No rule gains a case for a monitor, and no rule reads the device.
2. **The host decides the orientation and the size.** Windows' display orientation turns the screen, and its touch is mapped to the turned screen there; the browser runs in kiosk mode, full screen, with a profile that keeps its storage, since the Device's anonymous session lives in it. The app asks for no orientation and never locks one, as before.
3. **Larger text is the browser's font size.** The browser's font size setting grows the root font size and every rem with it, as the tablet's Font size does, and leaves the viewport alone; the Wall holds its layout to 130 percent as [look.md](../look.md), "Larger text" says. Zoom, which shrinks the viewport instead, is held to 125 percent either way (1536 by 864 and 864 by 1536, both still five or four days and three tiles). At 150 percent in portrait the viewport is 720 px wide, a phone by the rule, and the rule is not bent for a monitor: the ceiling is written down instead.
4. **Nothing scales up for the panel.** At 92 pixels per inch 16 px type is about 4.4 mm tall, 1.75 times its size on the P12 and read from further away; 100 percent is the default and the household chooses larger text if it likes. The look's tokens, parts and sizes are unchanged.
5. **The chrome and the screens are the Wall's.** Landscape at 1920 by 1080 is the landscape Wall with more room; portrait at 1080 by 1920 is the v9 portrait with more height. What is cut, overlapping, under 48 px or under the 14 px floor at those sizes, or at 1536 by 864 and 864 by 1536, is fixed; a band of empty screen that reads wrong is judged in its ticket and fixed when a rule in rem or a grid's minmax covers it. Nothing moves at 1280 by 800 or at the P12's landscape sizes; in portrait the Routines chart and the Lists screen lay their columns and cards in a grid, as many to a row as fit at 17 rem, each its row-mates' width, which the P12 gets too (0009's wrapping made precise).
6. **Touch is touch.** The Wall has no hover styles and gains none; a tap on the Elo is the same tap as on the tablet. The mouse cursor, the screen's sleep and wake, night dimming and the kiosk's exit are the host's, as they are Fully Kiosk's on the tablet; the app adds none of them.
7. **The Device is a Device.** The glossary's Device is a tablet or a PC's browser paired to the Household; pairing, the Pairing Code, the heartbeat and what a Device may write do not change.
8. **No new data**: no migration, no table, no column.

## User Stories

1. As a parent, I want the Wall on the 24-inch screen to use the whole screen in landscape, so that the week reads at a glance from across the room.
2. As a parent, I want the screen turned upright to show the portrait Wall, so that a tall screen reads down the days.
3. As a child, I want every tile and button to stay at least 48 px on the big screen, so that I hit what I aim for.
4. As the owner, I want a written set-up for the PC, so that the screen comes back as the Wall after a restart without my help.
5. As the owner, I want the tablet's Wall to look as it did, so that moving one screen changes nothing on the other.

## Implementation Decisions

### The rule

- `homeLayout` in `src/lib/home-layout.ts` changes nothing. `tests/home-layout.test.ts` says what it gives at 1920 by 1080 (landscape, five days, three tiles), 1080 by 1920 (portrait, four days, three tiles), 1536 by 864 (landscape, five, three), 864 by 1536 (portrait, four, three), 1280 by 720 (landscape, five days, two tiles) and 720 by 1280 (a phone).
- The inline script in `index.html` changes nothing.

### The screens

- Every Wall screen (Home with three tiles and with none, Week, Month with six weeks, Day, Meals, Routines, Lists, the Add event sheet, the pairing-code screen, the header and the people strip) is checked at 1920 by 1080, 1080 by 1920, 1536 by 864 and 864 by 1536, in both modes, by eye and by measure. What is cut, overlapping, under 48 px or under 14 px is fixed in the ticket that finds it, by the look's rules: rem for what follows the text, px for what a finger needs, a container query or a grid's minmax for what follows the room, the `phone:` variant for the phone and never a width or height media query.
- 1280 by 800, 1472 by 920 and 1732 by 1082 are rendered before and after, and nothing differs.
- Found at the Elo's sizes and fixed (#189): the Lists screen and the Routines chart in portrait are a grid of columns at least 17 rem (`repeat(auto-fill, minmax(17rem, 1fr))`), so a card no longer takes the landscape peek width and a column alone on its row is its row-mates' width; the pairing screen says "Pair this screen". Ruled out: the chart's 28 rem column cap in landscape (a reading width; raising it would move a two-person Wall at 1280), a cap on the Day view's lanes and wider people pills (both move the P12 in landscape), Meals' words at a cell's top left (0009's ruling), Home's lower row in portrait (its emptiness is the data's).

### The host

- `docs/windows-kiosk.md` is the Elo's set-up, beside `docs/fully-kiosk.md`: the display's orientation and touch mapping in Windows, 100 percent scaling, the browser's kiosk flags and the profile that keeps its storage, the launch at sign-in, larger text by the browser's font size, zoom's ceiling, the cursor, sleep and wake, and the exit. `docs/go-live.md`'s pairing step names both documents. `docs/fully-kiosk.md`'s first line says the Wall may also be the Elo and points across.
- `CONTEXT.md`'s Device says a tablet or a PC's browser. `docs/PLAN.md` gains the v10 section and `CLAUDE.md` the read-first line. `docs/look.md` gains "A 24-inch screen" with the sizes and ceilings above.

### Testing Decisions

- Pure, with unit tests: `homeLayout` at the six sizes above.
- Through `renderToStaticMarkup`, as the phone's and portrait's tests do: a test for each fix a ticket makes, at the size that found it.
- Nothing new through the data seam: no new query. The existing tests pass unchanged.
- Screens are checked at the four Elo sizes in both modes, and at 1280 by 800, 1472 by 920 and 1732 by 1082 to see nothing moved.

## Out of Scope

- A rule that reads the device, the pixel density or the screen's inches; the viewport alone decides (0004, 0009, #176).
- A larger type scale, a denser layout or a new part for a big screen; the look is one look.
- Any change to `/settings`, the phone, or the mode rules; the Elo's mode is the Household's Appearance and the switch, as on the tablet.
- Hover styles, a cursor style, a screensaver, dimming or a wake schedule in the app.
- Fully Kiosk on the Elo: it is not an Android device. An Android box driving the Elo would follow `docs/fully-kiosk.md` and this spec's sizes, unchecked.
- Swiping between days or weeks.

## Further Notes

- The Elo's 16:9 is a little wider than the tablet's 16:10 for its height; nothing in the Wall is tied to either ratio, and the extra width goes to the day columns and the Month cells, which are rem minimums and `1fr` shares.
- The panel is an LCD: dark mode at night costs nothing and burn-in is no concern. Its brightness is the monitor's own menu and the host's.
- Windows' scaling and the browser's zoom both shrink the viewport by the same factor; the browser's font size grows the rem instead. The sizes in this spec are CSS px at whatever the host gives.
