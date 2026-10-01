# Skylight Calendar compared with Nidus

Researched on 2026-10-01. The design and on-device behaviour come from Skylight's own help center (skylight.zendesk.com: 436 articles and their screenshots, edited through that day). Hardware, pricing and reception come from product pages, retailer listings and reviews, which are weaker; anything only they say is marked "reported". "Plus" marks a feature behind Skylight's paid plan (reported at $79 a year). Nidus is as of `master` at `b132f96`.

The last column is the ruling that became [spec 0002](specs/0002-skylight-gaps.md): **Build**, **Have** (parity or better), or **Skip** with the reason.

## Calendar

| Skylight | Nidus | Ruling |
| --- | --- | --- |
| Four views: Schedule (1 to 7 day columns on a time grid), Day, Week (day cells), Month | Home (today + 4 on a time grid), Week, Day | **Build** the month view. Home is Skylight's Schedule. |
| Month cells: start time and title pills, up to three, then "N more"; tap opens a popup; today is a filled circle | None | **Build**: each day one button into the Day view, a few lines and "+N more" |
| Top bar on every tab: date, time, local weather | Household name only | **Build** clock, date and weather |
| Weather icons on the next ten days of the month | None | **Build** per-day icon, high and low on day headings |
| Filter button: a panel of per-Profile toggles | None | **Build** as chips in the header, one tap instead of two, clearing itself after two minutes |
| Events as rounded pastel blocks: title, time range, the person's avatar; side-by-side lanes for overlaps | Tinted blocks with a colour edge: title and start time; lanes for overlaps | **Have**. Colour is never the text, which keeps AAA contrast on a dark wall. |
| Multi-person events drawn two-tone | Edge split into one stripe per Profile | **Have** |
| Today as an orange circle, current time as an orange line | Today's column lifted and underlined, a line at the current time | **Have** |
| Create, edit and delete events on the device and in the app; fields: title, start, end, all day, Profile, repeat, which synced calendar | Native Events on the Wall and the phone: title, date, start, end, all day, where, notes, Profiles | **Have**, except repeat |
| Repeating events created on the device | Native Events are one-off; Google's repeating events are mirrored as occurrences | **Skip**: a repeating event belongs in Google (ADR 0002) |
| Google two-way; Outlook, iCloud, Yahoo, Cozi one-way; calendars by URL (reported) | Google, read-only | **Skip**: ADR 0002 and PLAN.md. A holiday or team calendar subscribed in Google mirrors like any other. |
| Countdown bar under the header for flagged events | None | **Skip**: an all-day event already shows on its day |
| Dim past events, shade weekends, week starts Sunday or Monday | Week starts Sunday; nothing dims | **Skip** |
| Tap and hold an empty slot to create (2024 help text; unconfirmed in 2026) | Add event button, defaulting to the day the Wall is on | **Skip** |
| Magic Import and Sidekick: events from email, PDFs, photos, voice (Plus) | None | **Skip**: dropped in PLAN.md |
| Reminders per event (reported) | None | **Skip**: a wall has nobody to notify |
| 12-hour clock only | 12-hour | **Have** |

## Routines, chores and rewards

| Skylight | Nidus | Ruling |
| --- | --- | --- |
| Tasks tab, Day view: a column per person, tinted in their colour, with avatar, name, "n/m" progress bar | Today's Routines by Profile in a 24 rem rail on Home | **Build** a full-screen chart with a column per Profile and progress |
| Routines sit in Morning, Afternoon or Evening; the device shows the current period | A flat ordered list per Profile | **Build** time of day as groups. All groups stay visible: a child checks the evening list in the morning too. |
| Tap the circle to complete; done rows fill with colour and a check | Tap; the button fills with the Profile's colour, a check and a strike-through | **Have** |
| "Emoji rain" when tasks are finished; character animations with the Disney add-on | Nothing marks finishing | **Build** a short burst when a tap finishes a Profile's day; none under reduced motion |
| Edit a chore or routine | Archive and recreate | **Build** edit in place on the phone |
| Chores: one-off or repeating tasks with a date, "Up For Grabs" column anyone can claim | Routines repeat on days of the week | **Skip**: PLAN.md dropped chores with rollover. A one-off job is a list item. |
| Stars per task, a Rewards tab with costs and Redeem (Plus; set up in the phone app) | None; Routine Completions are kept | **Skip**: a points economy needs its own decisions (who redeems, do unticks claw back). The history it would be computed from already exists. |
| Tasks week view per person | None | **Skip** |

## Lists

| Skylight | Nidus | Ruling |
| --- | --- | --- |
| Several lists as side-by-side cards, add on device or app, check off, "Clear Completed" | Several Shared Lists, one pinned to Home, add, cross off, clear completed, reorder | **Have** |
| Sections inside a list, a colour per list, drag to reorder | Arrow buttons reorder; no sections or colours | **Skip** |
| Instacart button on grocery lists (Plus, US) | None | **Skip** |

## Meals

| Skylight | Nidus | Ruling |
| --- | --- | --- |
| Meals tab (Plus): seven day columns by Breakfast, Lunch, Dinner, Snack; tap a cell to add | None | **Build** the grid with free text per cell |
| Meals shown on the calendar | None | **Build** a "Today's meals" card on Home |
| Recipe box, recipes from a URL or photo, AI meal plans, ingredients to the grocery list (Plus) | None | **Skip** |

## Photos, sleep and idle

| Skylight | Nidus | Ruling |
| --- | --- | --- |
| Photo and video screensaver after 1 to 10 minutes, with time, weather and upcoming events over it (Plus) | None | **Skip**: Fully Kiosk Browser owns the screensaver (`docs/fully-kiosk.md`) |
| Sleep schedule that turns the display off; automatic brightness | None | **Skip**: Fully Kiosk owns both |

## Hardware, apps and accounts

| Skylight | Nidus | Ruling |
| --- | --- | --- |
| 15 inch 1920×1080 (Calendar, and Calendar 2 from 2026), 27 inch 2560×1440 Max; about $250 to $630 (reported) | Any Android tablet in Fully Kiosk | Not comparable |
| iOS and Android apps, a web portal for photos | A phone-sized settings site; the Wall on a phone is tickets #49 and #50 | Those tickets stay with spec #1 |
| Six-digit activation code links a device to an account | Six-character Pairing Code claimed from the phone | **Have** |
| Invited family members; a parental lock on editing (reported) | One Household Account administers; a Device can tick, list and add events but never administer | **Have** by a different route |
| Needs Wi-Fi; no offline mode (reported) | Keeps the last data on screen, says it is offline, reconnects by itself | Nidus is ahead |
| Text size, display density, week start, brightness settings | Household name and timezone | **Skip** |

## Design

| Skylight | Nidus | Ruling |
| --- | --- | --- |
| Light theme only on the device: white ground, pastel fills, serif headings | Dark theme only, WCAG AAA | **Keep** Nidus's: the wall must not glow at night (PLAN.md) |
| Left rail of icon-and-label tabs in landscape: Home, Calendar, Lists, Tasks, Rewards, Meals, Recipes, Photos, with Sleep and Settings at the foot | No navigation: header buttons for Week, Day and Lists, and a Home button inside the paged views | **Build** a left rail: Home, Day, Week, Month, Routines, Meals, Lists |
| Information bar: date, time, weather; per-tab controls on the right | Household name, two status badges, buttons | **Build** the header: name, clock and date, weather, Profile chips, Add event |
| A round "+" floating at the bottom right adds an event | "Add event" button in the header | **Have** |
| Home screen with panes the family chooses (calendar, tasks, lists) | Home: five days, Routines rail, Pinned List | **Have**: Nidus's home screen is the settled version of the same idea |
| Avatars: an initial, a built-in picture or a photo; shown on events and task columns | A colour dot and the name; `avatar_url` is stored but not drawn on the Wall | **Skip**: colour and name read from across a room |
| Swipe between days, weeks and months; pinch to zoom the schedule | Previous, Today and Next buttons | **Skip** |

## Where Nidus is already ahead

- It keeps working through an outage: the last data stays on screen and it reconnects by itself.
- It is dark, and every colour on it clears AAA contrast.
- Lists reorder from the Wall and one list is pinned to the home screen.
- Nothing is behind a subscription, and nothing leaves the Household's own Supabase project except the read from Google.

## What v2 builds

Seven tickets under spec 0002: the Wall shell (rail and clock), Routine time of day and editing, the month view, the Profile filter, weather, Meals, and the Routines chart with progress and a celebration.

## Sources

- Skylight help center, `https://skylight.zendesk.com/hc/en-us/articles/`: Navigation and Menus (36824456433051), The Home Screen (49738702477723), Using the Calendar Tab (36625171368987), Example Calendar Views (48026687853083), How To Use The Filter Function (34946198734747), Countdowns (40459070511515), Using the Tasks Tab: Routines and Chores (36846381293979), Using the Rewards Tab (36846860676123), Stars, Tasks and Rewards (36846200077723), The Lists Tab (37275069922971), The Meals Tab (41418036777371), The Photos Tab (51737334761371), Using Sleep Mode (37235485034779), General Settings (36835387462555), Calendar Settings (36835449004315), Photo Settings (36835919949339), Does Skylight Calendar show military time (36058190127899), Weather in Month View (52712061182875), Swipe for Month View (53718572814107), When do Disney Task Celebrations appear (52079895032475).
- Skylight's own pages: `https://myskylight.com/how-to-manage-chores-and-family-tasks-with-skylight-calendar`, `https://myskylight.com/how-to-meal-plan-with-skylight-calendar-time-saving-tips-for-families/`, `https://myskylight.com/lp/sidekick/`, `https://myskylight.com/introducing-skylight-disney-mode/`.
- Reviews and listings (reported facts): `https://www.reviewed.com/smarthome/content/skylight-calendar-2-review`, `https://techcrunch.com/2026/01/07/skylight-debuts-calendar-2-to-keep-your-family-organized`, `https://blog.bestbuy.ca/smart-home/skylight-touchscreen-calendar-smart-display-review`, `https://wetried.it/skylight-calendar-review/`, `https://www.digitaltrends.com/home/skylight-ai-assistant-sidekick-meal-prep/`.
- Not established: the number and names of Skylight's preset Profile colours, any device-level dark mode (none is documented), sync latency, and whether streaks or completion history exist (none is documented).
