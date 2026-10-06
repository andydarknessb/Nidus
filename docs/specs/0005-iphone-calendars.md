# Nidus v5: iPhone calendars

Tracker: GitHub issue #115; its sub-issues are the tickets. Vocabulary: [CONTEXT.md](../../CONTEXT.md). Decisions: [PLAN.md](../PLAN.md) (v5 section) and [ADR 0003](../adr/0003-icloud-by-public-link.md). The look: [look.md](../look.md).

## Problem Statement

The Wall shows Google calendars only. The family keeps their calendars on their iPhones, in iCloud, so what they plan there never reaches the Wall. Apple offers no sign-in that would let the Wall read an iCloud calendar the way it reads Google's.

## Solution

An iCloud calendar can be made a Public Calendar on the iPhone, which gives a long secret link to an `.ics` feed. The owner pastes that link into Settings; the Wall keeps it in Vault, reads the feed every five minutes, and mirrors its events read-only, exactly as it mirrors a Google calendar: the same Mirrored Calendar, the same "who is it for", the same Synced Events, the same stale-sync badge. Nothing is ever written back to iCloud.

## User Stories

1. As a parent, I want to add my iPhone calendar to the Wall by pasting its link, so that what I plan on my phone shows on the Wall.
2. As a parent, I want plain steps beside the field telling me how to get the link on my iPhone, so that I do not have to look it up.
3. As a parent, I want to say whose calendar it is (a person, or everyone), so that its events take that person's colour and initial, as Google calendars do.
4. As a parent, I want a change on my iPhone to reach the Wall within a few minutes, so that the Wall is never a day behind.
5. As a parent, I want repeating events, moved and skipped occurrences, all-day events and events in another time zone to show as my iPhone shows them, so that the Wall can be trusted.
6. As a parent, I want to be told plainly if a link is not an iPhone calendar link, or stops working, so that I know to fix it.
7. As a parent, I want to remove an iPhone calendar, so that its events leave the Wall.
8. As a parent, I want the Wall to say when it has not heard from my iPhone calendar for a while, as it does for Google.
9. As the owner, I want the link kept secret and never shown to a tablet, so that nobody who walks past the Wall can read my calendar.

## Implementation Decisions

### Data

- `calendar_accounts` gains `provider` (`google` or `icloud`, default `google`). `google_email` becomes nullable: required for `google`, null for `icloud` (a check constraint says so). An `icloud` account's Vault secret is the feed's link, normalised (below). A new `feed_key` (a SHA-256 of the normalised link, not readable by clients) is unique per Household, so the same link cannot be added twice. Existing rows are all `google`.
- An `icloud` account has exactly one Mirrored Calendar, its `google_calendar_id` the literal `ics` (the column keeps its name; a comment says what it holds for each provider) and its `name` the feed's `X-WR-CALNAME`, else "iPhone calendar". It starts selected, for the whole Household; the owner sets who it is for in the existing picker.
- A Synced Event from a feed has `google_event_id` = the event's `UID`, a separator and the occurrence's original start as a UTC instant (its `RECURRENCE-ID` for a moved occurrence), so each occurrence keeps its key when it is moved and is replaced, not duplicated. The column keeps its name, with a comment.
- The feed's `ETag` and `Last-Modified`, as a small JSON object, are kept in the Mirrored Calendar's `sync_token`, which no client can read. They are not sent when the last full read is 24 hours old or more, so the window rolls forward even for a calendar nobody edits (ruling from review).
- RLS, grants and what a Device may read are unchanged: a Device reads accounts (without the secret), Mirrored Calendars and Synced Events, and writes none of them. The link is never in a column a client can select.
- One migration. It adds, it does not rename.

### The link

- Accepted: `webcal://` or `https://`, on a host that is `icloud.com` or ends in `.icloud.com`, with a path. `webcal://` becomes `https://`. Anything else is refused with "That is not an iPhone calendar link." No other scheme, host, port, user info or IP address is ever fetched.
- Fetching (one helper in `supabase/functions/_shared/`, used by both functions): redirects followed by hand, at most three, each target checked by the same host rule; 15 seconds at most; 2 MB at most (ruling from review: a 5 MB feed expands to more memory than an Edge Function has to spare); the response must parse as a calendar. Conditional requests with the stored `ETag` / `Last-Modified`; a 304 is "unchanged".

### Adding a link

- The owner (Household Account only) pastes the link in Settings. The `calendar-connect` function gets a new route that checks the session as `/start` does, normalises and checks the link, fetches it once (so a wrong link fails at once, in words), reads its name, then stores the account, the secret and the Mirrored Calendar through a service-role function. A Device or anonymous caller is refused.
- The first events arrive with the next five-minute sync; Settings says "First sync within 5 minutes".

### Sync

- `calendar-sync` reads every active account as now and branches on `provider`. An `icloud` account: read the link from Vault, fetch it conditionally, and on a change parse it and expand it into occurrences in the existing window (one month back, six ahead) and store them with the existing `replace_synced_events`, with the new `ETag` as the token. A 304 changes no event and still counts as a successful sync (`last_synced_at`).
- Parsing and expanding use `ical.js` (Mozilla), added to `package.json` and to the function's import map: `RRULE`, `RDATE`, `EXDATE`, overrides by `RECURRENCE-ID`, `VTIMEZONE` and `TZID`. All-day events (`VALUE=DATE`) start at the Household's midnight and end at the midnight after their last day, as Google's do. A time with no zone is read in the Household Timezone. No `DTEND`: `DURATION`, else one day for a date and zero length for a time. `STATUS:CANCELLED` is skipped. At most 1000 occurrences per event and 20000 per feed, so a rule with no end cannot run away. Titles, places and notes are cut as Google's are.
- A 401, 403, 404 or 410 means the link no longer works: the account becomes `needs_reauth` with "This link no longer works. Turn on Public Calendar again and paste the new link." Any other failure is a `last_error` and the next run tries again, as for Google.
- One feed's failure never stops another account's sync. Google accounts are synced first in each run and iCloud feeds after them, so a feed that exhausts the function cannot cost Google its sync (ruling from review).
- The expansion's work is capped per event, per feed and per run (steps walked, not only occurrences kept), so a few hostile feeds cannot use up the function's time; a feed cut short keeps its rows and says it will be read again. An event the parser cannot read is skipped alone, never the whole feed.

### Settings

- On `/settings/calendars`, under the Google accounts, a card "iPhone calendars": the steps in plain words ("On your iPhone, open Calendar, tap Calendars, tap the i next to a calendar, turn on Public Calendar, tap Share Link, then Copy Link. Paste it here."), a field labelled "Link" and an Add button; errors under the field in words.
- Each iPhone calendar is listed like a Google account: its name, "iPhone calendar", its status and last sync in the existing words, who it is for (the existing picker), and Remove. Removing deletes the account, its secret, its Mirrored Calendar and its Synced Events, as for Google.
- Words: "iPhone calendar" for the family; "iCloud" only where Apple's own steps name it. No em-dashes.

### Testing Decisions

- Through the one seam, against the local stack, as real principals. The HTTP the functions make is the only fake: Google's API as now, and now the feed's server, injected the same way. Never mock the database.
- The link rule and the expansion are pure and unit-tested: accepted and refused links (other hosts, IP addresses, ports, user info, `http`, a redirect off iCloud, too many redirects, oversize, a timeout); a weekly rule with an `EXDATE` and a moved occurrence, an all-day event, a floating time, a `TZID` across a DST change, a cancelled event, an endless rule capped, events outside the window dropped, the keys stable across reads.
- Through the seam: adding a link as the Household Account stores it and its Mirrored Calendar and refuses a Device and anonymous; the secret is never readable by any client; a sync writes the occurrences; a 304 keeps them and moves `last_synced_at`; a 404 marks the account; the same link twice is refused; removing cleans up.

## Out of Scope

- Signing in to iCloud (CalDAV, app-specific passwords), private iCloud calendars that are not made public, other providers (Microsoft, generic `.ics` links on other hosts), and writing back.
- Pushing Native Events to iCloud.
- A design canvas: the Settings card follows the existing calendar cards.

## Further Notes

- ADR 0003 records the choice and that the sync now expands repeats for this source, which 0002 had ruled out for Google.
