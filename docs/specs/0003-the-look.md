# Nidus v3: the look, light by day and dark at night

Tracker: GitHub issue #71; its sub-issues are the tickets. Vocabulary: [CONTEXT.md](../../CONTEXT.md). Decisions: [PLAN.md](../PLAN.md) (v3 section). The look itself, with every token and part: [look.md](../look.md). Engineering follow-ups from the same audit that are not about the look: #64 to #70.

## Problem Statement

The Wall works, and it reads as a wireframe. An audit of the v2 build found the same thin outline on every panel, row and button (1.24 to 1 against the page), no typeface, and almost one text colour, so nothing reads as a surface and nothing leads the eye. Whose event it is rests on a coloured edge alone, and events for the whole Household are a grey that looks switched off. Titles break in the middle of a word when two events share an hour. Routines, the screen made for the children, is the one that asks the most reading of them: a line of words beside a small circle. The Add event sheet is taller than the tablet. Lists leaves the shell and leaves out the list the family uses most. Only the clock can be read from across the room. And the Wall is dark at noon in a bright kitchen, because dark is all it has.

The owner wants it to look professional and to be friendly to children, in the way of the family wall calendars he compared it with, by day and by night.

## Solution

One look in two modes. By day the Wall is light: white cards on a pale ground, and the colour is in the content, where every event, tile and strip is filled with its person's colour and carries their initial. After sunset the same parts sit on dark surfaces. The chrome is neutral in both, text holds AAA contrast in both, and nothing depends on colour alone.

On that look, Home and Week become a schedule of stacked events under each day, so nothing collides and every title can be read; the Day view keeps the hour grid. A people strip shows each person's progress and filters the calendar. Routines get a picture each, large tiles, and a chart that opens on the part of the day it is now. Add event becomes a sheet that fits. Lists moves inside the shell with every list on it. The phone's settings become cards in plain words, with one new setting: how the Wall looks.

## User Stories

### Two modes

1. As a family member, I want the Wall light by day, so that I can read it in a bright room.
2. As a family member, I want the Wall dark after sunset, so that it does not glare in a dim one.
3. As a family member, I want a switch on the Wall to change it by hand, and for the Wall to go back to its own rhythm afterwards, so that one tap never leaves it wrong for days.
4. As a parent, I want to choose on my phone whether the Wall is always light, always dark, or follows the sun, so that it suits our house.
5. As a family member with poor eyesight, I want every word to keep its contrast in both modes, so that neither is the hard one to read.

### People and colour

6. As a family member, I want every event filled with its person's colour and marked with their initial, so that I can tell whose it is without relying on colour.
7. As a family member, I want an event shared by two or three people to show each of them, so that a shared event does not look like one person's.
8. As a family member, I want events for the whole Household to look like everyone's and not like a faded one, so that the family's plans do not read as switched off.
9. As a family member, I want a strip of people across the top with how each one's Routines are going, so that I see the family at a glance.
10. As a family member, I want to tap my name on that strip to see my events and the whole Household's, and for any touch on the calendar to keep that view open, so that it does not let go while I am reading.

### Calendar

11. As a family member, I want each day on Home and Week to list its events in order, one under the other, so that no title is ever cut inside a word.
12. As a family member, I want a day that has more than fits to say how many more, and to open that day when tapped, so that nothing is hidden without a sign.
13. As a family member, I want today's date in a filled disc on every view, so that I find today the same way everywhere.
14. As a family member, I want the event that is on now to be ringed, so that I see where we are in the day.
15. As a family member, I want the Day view to keep its hours, with an hour never shorter than a finger, so that the shape of a busy day is still there when I need it.
16. As a family member, I want an event's details to say who it is for and, for a Google event, where to change it, so that I am not left looking for an Edit button.

### Routines

17. As a child who cannot read yet, I want a picture on each of my Routines, so that I know which is which.
18. As a parent, I want to pick that picture when I make or edit a Routine, so that it takes a tap and no drawing.
19. As a child, I want large tiles with a big ring to tap, so that I hit the one I mean.
20. As a child, I want the chart to show the part of the day it is now, so that the evening is not buried under the morning.
21. As a child, I want a Routine I missed earlier to stay in front of me, so that the part of the day ending does not hide it.
22. As a child, I want a finished Routine to fill with my colour and keep its words, so that done looks done and can still be read.
23. As a family member, I want Home to show what each person has left to do right now, one tile each, so that the next thing is one tap away.
24. As a child, I want a failed tick to say so beside the tile, in words I understand, and to go away when the connection is back, so that I know to try again.

### Add event

25. As a parent, I want the whole Add event sheet on the screen at once with its buttons in reach, so that I never scroll to save.
26. As a parent, I want the end time to follow the start time, so that an afternoon event does not fail because the end was left at 10 AM.
27. As a parent, I want to pick today or one of the next two days with one tap, and any other day with two, so that the common case is fast.
28. As a parent, I want a stray tap outside the sheet to leave what I typed alone, so that I do not lose it.
29. As a parent, I want the Wall to say what it saved and for when, so that an event outside the days on screen does not make me add it twice.

### Lists and Meals

30. As a family member, I want Lists inside the Wall's shell with every list on it, the pinned one first, so that the groceries are where I look for them.
31. As a family member, I want each list to show how much is left to get, so that I can tell a full list from an empty one.
32. As a family member, I want the header to say what the next meal is, so that "what's for dinner" is answered on every screen.

### Feedback

33. As a family member, I want every button to answer my tap at once, so that I know the Wall felt it.
34. As a keyboard or switch user, I want a focus ring I can see on every control in both modes, so that I know where I am.

### Phone

35. As a parent, I want the phone's settings in cards with a way to jump between Household, Calendars, Routines and Lists, so that pairing a tablet is not at the bottom of one long form.
36. As a parent, I want plain words (people, tablets, time zone), so that the settings read like a household and not like a system.
37. As a parent, I want a new person to start on a colour nobody has, and to see which colours are taken, so that two children do not share one by accident.
38. As a parent, I want deleting a person to say what goes with them, so that their Routines and history do not vanish unannounced.

## Implementation Decisions

Two new words. The **schedule** is the calendar drawn as a list of events under each day. The **people strip** is the row of people under the header on the calendar screens. Neither is a glossary term; both are parts of the Wall.

- **Tokens**: `docs/look.md` is the table. The existing token names stay (`--background`, `--card`, `--muted`, `--accent`, `--border`, `--input`, `--foreground`, `--muted-foreground`, `--primary`, `--destructive`, `--ring`) and gain `--ink`, `--everyone`, `--scrim` and `--destructive-foreground`. They are defined twice in `src/index.css`, under `:root[data-mode='light']` and `:root[data-mode='dark']`, and mapped once in `@theme inline`. `src/lib/look.ts` holds the same values, the ten colour families and the contrast function; a test reads `index.css` and fails if the two disagree, and holds every pair in `look.md` to its floor in both modes.
- **Mode**: the document's `data-mode` attribute is the only switch; no component branches on the mode for colour. `resolveMode` is one pure function of the Household's Appearance, the screen's override, the time, and today's sunrise and sunset: an override that has not expired wins; otherwise Light or Dark as set; otherwise Auto, which is light from sunrise to sunset. Sunrise and sunset come from the forecast the Wall already fetches (`daily=sunrise,sunset` joins the request); with weather off or no forecast for today they are 7:00 and 19:00 in the Household Timezone.
- **The switch**: a round button at the foot of the navigation rail, above Add event, on every screen. It sets an override on that screen only (kept in `localStorage`, never written to the database, so a Device needs no new grant) that lasts until the next sunrise or sunset. An inline script in `index.html` sets `data-mode` before the first paint from the mode the screen last resolved, so the Wall never flashes the wrong one. `color-scheme` and `theme-color` follow the mode.
- **Appearance**: `households.appearance`, one of `auto` (the default), `light`, `dark`. The Household Account sets it on the phone; a Device reads it. The table-level grants already cover the column.
- **The phone's own pages** follow the phone (`prefers-color-scheme`, light when it does not say), not the Household's Appearance, which is about the Wall.
- **People's colours**: a Profile still stores one colour, the 300 step of its family. A person's element carries that family's four steps as CSS variables and the class `person`; the roles (soft, fill, base, strong and the rest, as in `look.md`) are derived from them in CSS, once for each mode, the dark ones with `color-mix`. So a person's colour changes with the mode with no code. A stored colour that is not in the palette still gets steps, by mixing it with white and with the ink.
- **Type**: Young Serif and Lexend, shipped with the app as packaged font files, so no request leaves for a font service and the Wall draws the same with no network. The clock's digits sit in fixed-width cells.
- **One button**: `src/components/ui/button.tsx` is rewritten as the only button, with four voices (primary, secondary, quiet, delete), two sizes (Wall, phone), a pressed state that dips and takes `--accent`, and one disabled look. The per-file class strings go as each screen is touched.
- **Base rules**: `:focus-visible` is a 2 px ring in `--ring`, offset 2 px, everywhere. Fields are `--muted` with a 1.5 px `--input` ring; placeholders are `--muted-foreground`; native checkboxes and radios take `accent-color` from `--foreground`.
- **Shell**: the navigation rail keeps its entries and gains the switch. Routines gets an icon that is not a checklist. The current entry is `--accent` with a ring. The header is the clock (68 px), the Household's name over the date (40 px), the weather, the next meal, and the Offline and stale-sync marks as small pills with an icon. The Profile chips leave the header for the people strip.
- **People strip**: one row under the header on the calendar screens (Home, Day, Week, Month). Everyone first, then a pill for each Profile on its soft colour: the disc, the name, and today's Routines as "3 of 5" with pips, or "All done", or nothing when that Profile has none today. It keeps the Profile filter's rules (press to filter, Everyone clears, whole-Household events always show). The filter's two minutes restart on any touch inside the calendar, and clearing it is announced. With more people than fit, pills shrink to a floor and then the row scrolls sideways behind a visible "More people" button.
- **Schedule**: Home (today and four days) and Week (Sunday to Saturday) draw a column for each day: a heading that opens the day (weekday, the date, the forecast line), then that day's events as pills, all-day first, then by start, then by title. A day lists an event by its real span, as Month does. One pure function builds the columns from the occurrences `useOccurrences` already reads, so the Profile filter still applies in one place. When a column cannot hold its pills, it shows as many as fit and a "4 more" button that opens the day; how many fit is decided by a pure function from measured heights.
- **Event pill**: at least 52 px tall; the title on up to two lines, wrapping between words only; the time under it ("All day", "9:00 AM"); the person's disc at the right. One Profile: its fill. Two or three: equal bands, left to right in Profile order, and a disc each. More than three: three bands and a count. Every Profile of the Household, or none: `--everyone` and the house disc. The accessible name says the title, who, the day and the time. The event that is on now on today's column has a ring.
- **Day view**: keeps the hour grid at 48 px an hour, so an hour-long event is never drawn longer than it is. The grid shows the whole hours that fit and follows the clock: on today it starts one hour before now, on another day at its first timed event or 8 AM, and it never runs past midnight. Timed events that end before the window sit as pills in an Earlier row above the grid, and those that start after it in a Later row below. Two events may sit side by side; a third and more fold into a count that opens a list. The now line runs behind the blocks.
- **Event details**: the sheet says who the event is for. A Synced Event says "From Google Calendar. Change it there." A Native Event says "Added here. Not in Google Calendar."
- **Today**: the date in a `--primary` disc, on Home, Week, Day, Month and Meals.
- **Routine picture**: `routines.picture`, a short key or null. The app maps a known key to a picture from a fixed set of about two dozen (a toothbrush, a bed, a shirt, a school bag, a book, a paw, a plant, toys, bins, a plate and so on); an unknown key or null draws a plain mark. The phone's Routine form picks it from a grid. The migration adds the column to the insert and update grants, so it stays Household Account only.
- **Parts of the day**: morning from 5:00, afternoon from 12:00, evening from 17:00, in the Household Timezone. The Routines chart has a control for Morning, Afternoon, Evening and Whole day, and opens on the part it is now. A part shows its own Routines, then any Routine from an earlier part that is still not ticked ("Left from earlier"), then Any time, and a foot line that counts what was done earlier. When everything shown for a part is ticked, the part says so. The celebration still marks the whole day.
- **Routines chart**: a column for every Profile that has a Routine on any day, in Profile order, reading "Nothing today" when it has none today, so a child's column never moves. A column hugs what it holds.
- **Routine tile**: 80 px, the picture, the words on up to two lines, a 44 px ring. Done fills with the person's base colour and keeps its words. A tick that could not be saved says so in that person's column ("No internet, so that did not save. Try again soon.") and the line goes when the screen is online again.
- **Up next**: Home's right rail starts with what each person still has to do now: for each Profile in order, the first Routine not ticked among the current part's, what is left from earlier, and Any time. One tile each, at most three, with a link to the chart that counts the rest. When nobody has anything left it says so.
- **Add event sheet**: two columns on the Wall with the title row and the footer always in view; one column with the same footer on a narrow screen. "When" offers today, the next two days and "Another day", which shows the date field. Starts and Ends are steppers of 15 minutes, and moving Starts moves Ends by the same amount. All day is a switch. "Who is it for?" is the people as pills, with Everyone. The sheet closes on Close, Cancel and Escape; a tap outside closes it only while nothing has been typed. After a save, an edit or a delete the shell says what happened ("Added Plumber coming: Fri, Oct 2, 2:00 PM") for a few seconds in a polite status region.
- **Lists**: `lists` becomes a view of the Wall's route, drawn inside the shell, and the full-screen overlay goes. Every Shared List is a card with its count, its add row and its items, the Pinned List first and marked "On the home screen". A long list scrolls inside its card. Home's card is the Pinned List: the rows that fit, then "and 3 more", which opens Lists. Adding from Home says what was added.
- **Meals**: the plan keeps its week by slot grid, restyled: a planned Meal on `--everyone`, an empty slot a quiet plus. The header's next-meal button shows the first planned slot of today that is still ahead (breakfast until 10:00, lunch until 14:00, a snack until 17:00, then dinner), opens Meals, and is absent when nothing is planned or on Meals itself. It replaces Home's Today's meals card.
- **Month**: takes the tokens, the disc for today and the person's fill on its event lines. Nothing else about it changes.
- **Phone settings**: a top bar (the Household's name, "Open the Wall"), then tabs for Household, Calendars, Routines and Lists. Household holds cards for the Household (name, time zone), Appearance, Weather, People and Wall tablets, then Sign out. Calendars holds the Calendar Accounts and the events added on the Wall (`/settings/events` leads there). Words the family reads say people, tablets, time zone, lists and unpair; the glossary's words stay in code. Time zones are shown by name ("Central Time (Chicago)"). A new person starts on the first colour nobody has, and a colour in use shows whose it is. Deleting a person names what goes too. The "Picture address" field goes; the column stays. A calendar that failed its last update says so in a sentence, not in the provider's words.
- **Small debts the redesign pays**: each page sets its own document title. The manifest stops asking for landscape, which the phone's pages never wanted. Paging buttons carry arrows.
- **Schema**: two additive migrations, `households.appearance` and `routines.picture`. Both reach the hosted project before the pull request that reads them is merged, in one `supabase db push` from its branch.
- **Nothing changes in the mirror**: no Edge Function, cron job or sync behaviour is touched, and Realtime gains no table.

## Testing Decisions

- **Seam**: unchanged. The two new columns are exercised through the Supabase JS client against the local stack as each principal: the Household Account sets them, a Device reads them and cannot write them, another Household's principals see neither, and a client with no session sees nothing.
- **The look is tested as data**: every pair of words and ground in `look.md` at 7:1, every meaningful shape at 3:1, for all ten families in both modes, and the CSS tokens equal to the TypeScript ones.
- **Pure logic**: unit tests for the mode (Appearance, an override and its expiry, sunrise and sunset, the fallback hours, the Household Timezone across a DST change), the schedule (order, an event's span across days, on now, how many pills fit), a pill's people (one, shared, more than three, everyone), the Day view's window and its Earlier and Later rows, the parts of the day (which part it is, what a part shows, what is left from earlier, Up next, a part being done), the event form (Ends following Starts, a stepper crossing midnight, an untouched form), the next meal, the first free colour, and time zone names. Every date test takes the Household Timezone; none reads the machine's zone.
- **Screens**: there is still no component-test harness. Each ticket's screens are checked by hand against the local stack at 1280 x 800, in both modes, before merge; the phone's at 390 wide.

## Out of Scope

- Stars, points and rewards; photo avatars. An initial disc is not a photo.
- Recurring Native Events, two-way sync, other calendar providers (ADR 0002).
- The Wall on a phone below 768 px (#50), which waits for this spec.
- Starting with no connection and a cached app shell (#70); larger text sizes (#69); the Realtime, read-loop and focus follow-ups (#64 to #68).
- A sleep schedule, dimming and a screensaver: Fully Kiosk Browser owns these.
- Swipe, drag to reschedule, tap an empty slot to create.
- Motion beyond a control's press, a tick, and the celebration that already exists.

## Further Notes

- Build order: the foundations first and alone (tokens, modes, type, the button, the shell). Then, side by side on that: the Appearance setting, the people strip and schedule, Routines, the Add event sheet, Lists, Meals and the phone's settings. Then the Day view and Month, which build on the schedule's parts.
- The audit that led here, and the approved drawings of every screen in both modes, are on the owner's design canvas. `look.md` carries everything from it that the code needs.
- This reverses two lines the earlier specs wrote down: "dark theme only", and a light theme being out of scope. AAA contrast, the 48 px touch target and the landscape Wall stay.
