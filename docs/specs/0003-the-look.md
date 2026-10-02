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
24. As a child, I want a failed tick to say so under my own Routines, in words I understand, so that I know to try again.

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

### Tokens, modes and type

- **Tokens**: `docs/look.md` is the table. The existing token names stay (`--background`, `--foreground`, `--card`, `--popover`, `--muted`, `--muted-foreground`, `--secondary`, `--accent`, `--primary`, `--primary-foreground`, `--destructive`, `--border`, `--input`, `--ring`, `--radius` and their `-foreground` partners) and gain `--ink`, `--everyone`, `--scrim` and `--destructive-foreground`. The light values sit on `:root` and the dark ones under `:root[data-mode='dark']`, so a page with no mode set is light, never colourless. They are mapped once in `@theme inline`, and Tailwind's `dark` variant is bound to `[data-mode='dark']`. `src/lib/look.ts` holds the same values and the ten colour families, and takes the palette and `contrastRatio` from `profiles.ts`; a test reads `index.css` and fails if the two disagree, and holds every pair in `look.md` to its floor in both modes.
- **Mode**: the document's `data-mode` is the only switch; no component branches on the mode for colour. `resolveMode` is one pure function of the Household's Appearance, the screen's override, the time, and today's sunrise and sunset: an override that has not expired wins; otherwise Light or Dark as set; otherwise Auto, which is light from sunrise to sunset. Sunrise and sunset come from the forecast the Wall already fetches (`daily=sunrise,sunset` joins the request). Open-Meteo writes every time in one answer with one offset from UTC, the answer's `utc_offset_seconds`, even when the days cross a daylight saving change; the parser turns each sunrise and sunset into an instant with that offset, and never with the Household Timezone's rules or the machine's. With weather off or no forecast for today they are 7:00 and 19:00 in the Household Timezone (`wallMs`, which `native-events.ts` now exports).
- **Before it knows**: a screen keeps the mode it last resolved (light when it has none) until the Household is read. Light, Dark and an override that has not ended then resolve at once; Auto also waits, when the Household has a weather place, until the first forecast read has finished or failed. The pairing screen is always light. While a forecast is being read again, the last sunrise and sunset stand, so the Wall does not flip when the weather place or unit changes.
- **The switch**: a round button at the foot of the navigation rail, above Add event, on every screen. It sets an override on that screen only (kept in `localStorage`, never written to the database, so a Device needs no new grant) that lasts until the next sunrise or sunset. It works as soon as the Household is read; one set before the first forecast has been read ends at 7:00 or 19:00. An inline script in `index.html`, wrapped so a failure leaves the page light, sets `data-mode` before the first paint: outside `/settings` from the mode the screen last resolved; under `/settings` from `prefers-color-scheme`, which the phone's pages then follow. `color-scheme` and `theme-color` follow the mode.
- **Appearance**: `households.appearance`, one of `auto` (the default), `light`, `dark`. The Household Account sets it on the phone; a Device reads it. The table-level grants already cover the column and the policies already keep the write with the Household Account.
- **People's colours**: a Profile still stores one colour, the 300 step of its family. An event, a tile and a strip are filled from their Profiles' colours, never from a Mirrored Calendar's: the Wall colours an event from its `profile_ids` and each Profile's own colour, never from the view's `color` or `colors`; the Calendars page drops the colour picker for a calendar, and the column stays. A person's element carries that family's four steps as CSS variables and the class `person`; the roles (soft, fill, base, strong and the rest, as in `look.md`) are derived from them in CSS, once for each mode, the dark ones with `color-mix(in srgb, …)` at the percentages `look.ts` exports. A stored colour that is not in the palette is drawn as the nearest family.
- **Type**: Young Serif and Lexend, shipped with the app as packaged font files, so no request leaves for a font service and the Wall draws the same with no network. Young Serif's numerals are set lining and tabular wherever it is used, so the clock reads at full height and never shifts.
- **One button**: `src/components/ui/button.tsx` is rewritten as the only button, with four voices (primary, secondary, quiet, delete), two sizes (Wall, phone) and one disabled look. Pressed, secondary and quiet take `--accent`; primary and delete only dip, so their words keep their contrast. The per-file class strings go as each screen is touched.
- **Base rules**: `:focus-visible` is a 2 px ring in `--ring`, offset 2 px, on every control. A field is the exception: focused, its own ring becomes 2.5 px of `--foreground` and it shows no second one. Fields are `--muted` with a 1.5 px `--input` ring; placeholders are `--muted-foreground`; native checkboxes and radios take `accent-color` from `--foreground`.
- **Status line**: one line that overlays the foot of the screen and takes no room, in a polite status region, shown for six seconds; a newer line replaces an older one. It carries what the event sheet did, from every screen, an item added on Home, and the filter clearing.

### The shell and the calendar

- **Shell**: the navigation rail keeps its entries and gains the switch. Routines gets an icon that is not a checklist. The current entry is `--accent` with a ring. The header is the clock (68 px), the Household's name over the date (40 px), the weather, the next meal, and the Offline and stale-sync marks as small pills with an icon. The clock, the date, the weather and the marks never shrink; the next meal's words give way first, then the Household's name. The Profile chips leave the header for the people strip.
- **People strip**: one row under the header on the calendar screens (Home, Day, Week, Month). Everyone first, then a pill for each Profile on its soft colour: the disc, the name, and today's Routines as "3 of 5" with a pip each, or "All done", or nothing when that Profile has none today. Past eight Routines the pips give way to the count alone. It keeps the Profile filter's rules (press to filter, Everyone clears, whole-Household events always show). The filter's two minutes restart on any touch inside the calendar, and its clearing is said on the status line. With one Profile there is no Everyone and the one pill shows progress and does not filter. With more people than fit, a pill shrinks to its disc and name, and then the row scrolls sideways behind a visible "More people" button.
- **Schedule**: Home (today and four days) and Week (Sunday to Saturday) draw a column for each day: a heading that opens the day (the weekday and the date), the forecast line under it and outside the button as today, then that day's events as pills, all-day first, then by start, then by title. A day lists an event by its real span, as Month does. One pure function builds the columns from the occurrences `useOccurrences` already reads, so the Profile filter still applies in one place. When a column cannot hold its pills it shows as many as fit and a "+4 more" button that opens the day. Each pill is measured, and again when the fonts have loaded; a pure function of the column's, the pills' and the button's heights decides how many show.
- **Event pill**: at least 52 px tall; the title on up to two lines, wrapping between words only; under it the time: "9:00 AM"; "All day" on each day an all-day event covers, and on a day a timed event covers from end to end; "Until 2:00 AM" on the last day of a timed event that began on an earlier one. A Native Event keeps its pin before the title. One Profile: its fill and its disc at the right. Two or three: equal bands, left to right in Profile order. More than three: the first three bands. Discs overlap, at most two and then a "+N" disc that counts the rest. Every Profile of the Household, or none: `--everyone` and the house disc. The accessible name says the title, who, the day and the time, and ends "added here" for a Native Event. Only a timed event that is on now, in today's column, has the ring.
- **Day view**: keeps the hour grid at 3 rem an hour (48 px), so an hour-long event is never drawn longer than it is. Above the grid one row holds the day's all-day events and then the timed ones that end before the grid's first hour ("Earlier"); below it one row holds those that start after its last ("Later"). Both rows always keep their place, so the hours that fit never depend on what they hold. The grid shows the whole hours that fit: on today from one hour before now, on another day from the first timed event that starts on that day (8 AM with none), never from before midnight, then slid back so it ends by midnight. A row that cannot hold its pills scrolls sideways. Two events may sit side by side; a third and more in the same cluster become "+N" in the second lane and open a list of that cluster. The now line is `--foreground` and runs behind the blocks.
- **Event details**: the sheet says who the event is for ("Everyone" for the whole Household). A Synced Event says "From Google Calendar. Change it there." A Native Event says "Added here. Not in Google Calendar."
- **Today**: the date in a `--primary` disc, on Home, Week, Day, Month and Meals.
- **Month**: takes the tokens, the disc for today, the person's fill on its event lines (the pin stays on a Native Event's line), and a hatch in `--input` for days beyond the calendar's range. Nothing else about it changes.

### Routines

- **Routine picture**: `routines.picture`, a key of at most 32 characters or null, with no check against the set. `look.md` lists the two dozen keys and the picture each one draws; an unknown key or null draws a plain mark. The phone's Routine form picks it from a grid. The migration adds the column to the insert and update grants; the policies keep the write with the Household Account.
- **Parts of the day**: morning from midnight until 12:00, afternoon from 12:00, evening from 17:00, in the Household Timezone. Morning starts at midnight, not at 5:00, so nothing of a new day is ever "left from earlier".
- **Routines chart**: a control for Morning, Afternoon, Evening and Whole day. It opens on the part it is now, and an open chart moves to a new part when that part begins; a part picked by hand holds until then. A part shows its own Routines, then any Routine of an earlier part that is not ticked ("Left from earlier"), then Any time. A Routine ticked while it is shown stays where it is, done, until the part changes. A foot line counts the earlier parts' Routines that are done and not shown. When everything shown for a part is ticked, the part says so. There is a column for every Profile that has a Routine on any day, in Profile order, reading "Nothing today" when it has none today, so a child's column never moves. A column hugs what it holds.
- **Routine tile**: the whole tile is the button: 80 px, the picture, the words on up to two lines, a 44 px ring. Done fills with the person's base colour and keeps its words.
- **A tick that did not save**: offline it says "No internet, so that did not save. Try again soon."; otherwise "That did not save. Try again." The line sits under that person's column on the chart and under the tile on Home, and goes at that person's next tick that saves.
- **Up next**: replaces the Routines rail on Home. At most three tiles, for the first three Profiles in order that have something left: each one's first Routine not ticked among the current part's, what is left from earlier, and Any time. A Profile with nothing left gets no tile. The card's heading row holds the link to the chart: it reads "All routines", or "5 more" when that many of today's unticked Routines are not shown. When nobody has anything left it says so. Up next takes the height it needs and the Pinned List card takes the rest of the right rail. A tap that finishes a Profile's day plays the celebration over the Up next card, where the tile was; on the chart it plays over the column, as now.

### Sheets, Lists, Meals

- **Add event sheet**: two columns on the Wall with the title row and the footer always in view; one column with the same footer on a narrow screen. "When" offers today, the next two days and "Another day", which shows the date field and opens its picker in the same tap. Starts and Ends are steppers of 15 minutes that stay on the chosen date: Starts stops at 11:30 PM, Ends at 11:45 PM, Ends is always at least 15 minutes after Starts, and moving Starts moves Ends by the same amount within those limits. Holding a stepper repeats it. A new event runs for an hour from the next whole hour when its date is today (11:00 PM at the latest) and from 9:00 AM on another day, until a stepper is moved. A time the clocks skip on a daylight saving day is refused with a sentence that says so. An event made before this, with a time off the quarter hour, keeps its times until a stepper moves one, which then lands on the next quarter hour inside the limits. An event that runs past midnight belongs in Google. All day is a switch. "Who is it for?" is the people as pills, with Everyone. The sheet closes on Close, Cancel and Escape; a tap outside closes it only while nothing has been typed or changed. After a save, an edit or a delete the status line says what happened ("Added Plumber coming: Fri, Oct 2, 2:00 PM").
- **Lists**: `/lists` becomes a view of the Wall's route, drawn inside the shell, and the full-screen overlay goes. Leaving it for a calendar view opens today, as from Routines. Every Shared List is a card with its count, its add row and its items, the Pinned List first and marked "On the home screen". A card keeps "Clear crossed off" and drops reordering, which stays on the phone. A long list scrolls inside its card, and a new item is scrolled into view. An item shows on one line on Home, on up to two on the Lists screen, and in full on the phone. Home's card is the Pinned List: its heading row holds the link to Lists, which reads "All lists", or "3 more" when that many items still to get are not shown; then the add row and the rows that fit. A row crossed off on Home stays where it is, ticked, for two minutes or until Home is left, so a second tap undoes it. Adding from Home says what was added on the status line.
- **Meals**: the plan keeps its week by slot grid, restyled: a planned Meal on `--everyone`, an empty slot a quiet plus. The header's next-meal button shows the first planned slot of today that is still ahead (breakfast until 10:00, lunch until 14:00, a snack until 17:00, then dinner until Household midnight, all in the Household Timezone), opens Meals, and is absent when nothing ahead is planned and on Meals itself. It replaces Home's Today's meals card.

### The phone

- **Phone settings**: a top bar (the Household's name, "Open the Wall"), then tabs for Household, Calendars, Routines and Lists. Household holds cards for the Household (name, time zone), Appearance, Weather, People and Wall tablets, then Sign out. Calendars is `/settings/calendars`: the Calendar Accounts and the events added on the Wall; `/settings/events` replaces its address with that one. Words the family reads say people, tablets, time zone, lists and unpair; the glossary's words stay in code. Time zones are shown by name ("Central Time (Chicago)"). A calendar that failed its last update says so in a sentence, not in the provider's words.
- **People**: a new person starts on the first colour nobody has; with all ten taken, on the one the fewest people have, palette order breaking ties. A colour in use shows whose it is and can still be picked. Deleting a person says what goes: "Their Routines and every tick go. Events only for them, and calendars set to them, become everyone's." The "Picture address" field goes; the column stays, and an edit never writes it.
- **Small debts the redesign pays**: each page sets its own document title. The manifest stops asking for landscape, which the phone's pages never wanted, and its two colours become the light ground. Paging buttons carry arrows.

### Schema

- Two additive migrations, `households.appearance` and `routines.picture`. Both reach the hosted project before the pull request that reads them is merged, in one `supabase db push` from its branch. The frontend reads with explicit column lists, so the build that is live ignores the new columns.
- **Nothing changes in the mirror**: no Edge Function, cron job, view or sync behaviour is touched, and Realtime gains no table.

## Testing Decisions

- **Seam**: unchanged. The two new columns are exercised through the Supabase JS client against the local stack as each principal: the Household Account sets them; a Device reads them and cannot write them; another Household's principals see neither; an unpaired anonymous session, which holds the same grants, is stopped by row-level security; a client with no session sees nothing.
- **The look is tested as data**: every pair of words and ground in `look.md` at 7:1, every meaningful shape at 3:1, for all ten families in both modes; the CSS tokens equal to the TypeScript ones; the dark mixes in `index.css` at the percentages `look.ts` exports.
- **Pure logic**: unit tests for the mode (each Appearance, an override and its expiry, sunrise and sunset read with the answer's own offset, the fallback hours, what a screen shows before it knows, a DST change); the schedule (order, an event's span across days, "Until", on now, how many pills fit); a pill's people (one, shared, more than three, everyone, a Native Event's name); the people strip's words and the filter restarting on a touch; the Day view's window (early morning, afternoon, 11 PM, another day, no events, an event across midnight, a 23 and a 25 hour day), its Earlier and Later rows and the lane fold; the parts of the day (which part it is, midnight to 5:00, what a part shows, left from earlier, a ticked Routine staying, Up next, a part being done, the any-day columns, an unknown picture key); the event form (Ends following Starts, the limits before midnight, an untouched form, the "Added" sentence); a list card's rows that fit; the next meal; the first free colour; time zone names. Every date test takes the Household Timezone; none reads the machine's zone.
- **Weather stays data**: the forecast parser is tested against a recorded Open-Meteo response that includes sunrise and sunset. Nothing fakes or calls the network in tests.
- **Screens**: there is still no component-test harness. Each ticket's screens are checked by hand against the local stack at 1280 x 800, in both modes, before merge; the phone's at 390 wide.

## Out of Scope

- Stars, points and rewards; photo avatars. An initial disc is not a photo.
- Recurring Native Events, Native Events that cross midnight, two-way sync, other calendar providers (ADR 0002).
- The Wall on a phone below 768 px (#50), which waits for this spec. The schedule's day function is the agenda it asks for, and its "dark theme" line becomes both modes.
- Starting with no connection and a cached app shell (#70); larger text sizes (#69: the Day view's hour is 3 rem, not a fixed 48 px, and the rest stays that ticket's); the Realtime, read-loop and focus follow-ups (#64 to #68).
- A sleep schedule, dimming and a screensaver: Fully Kiosk Browser owns these.
- Swipe, drag to reschedule, tap an empty slot to create.
- Motion beyond a control's press, a tick, and the celebration that already exists.

## Further Notes

- Build order: the foundations first and alone (tokens, modes, type, the button, the status line, the shell). They treat the Appearance as Auto with fixed hours and leave the Profile chips in the header and the Today's meals card on Home; the Appearance, people strip and Meals tickets take those over. Then, side by side: the Appearance setting, the people strip and schedule, Routines, the Add event sheet, Lists, Meals and the phone's settings. Then the Day view and Month, which build on the schedule's parts.
- The audit that led here, and the approved drawings of every screen in both modes, are on the owner's design canvas. `look.md` carries everything from it that the code needs.
- This reverses lines the earlier specs wrote down: "dark theme only" and a light theme being out of scope (v1, v2); the Profile chips in the header, the Routines rail and the Today's meals card on Home, and Lists as a full-screen screen (v2). It keeps the navigation rail's date rule, the filter's rules and two minutes, the celebration's rule, AAA contrast, the 48 px touch target and the landscape Wall.
- One capability goes: a Mirrored Calendar no longer has a colour of its own on the Wall. Its events take the colour of the Profile it is set to, or the whole Household's.
