---
status: accepted
date: 2026-10-06
---

# iCloud calendars are mirrored from their public link, and Nidus expands their repeats itself

The family keeps calendars on their iPhones in iCloud, and Apple offers no OAuth and no calendar API. The owner chose, from three ways in, to mirror an iCloud calendar from the link Apple gives when a calendar is made a Public Calendar: Nidus keeps the link in Vault, reads it every five minutes and mirrors it read-only, exactly as [0002](0002-read-only-calendar-mirror.md) mirrors Google.

We rejected signing in to iCloud over CalDAV with an app-specific password, because that password also opens the account's mail and contacts and is a far weightier secret to hold than one calendar's link. We rejected subscribing to the link from Google Calendar and mirroring it from there, because Google refreshes such subscriptions only every 12 to 24 hours.

## Consequences

- 0002's "Nidus never parses RRULEs" no longer holds for this source: a feed carries its repeats as rules, so the sync expands them (rules, exceptions, moved occurrences, time zones) into occurrences inside the same rolling window, with a library, not by hand. Google's events still arrive expanded.
- A calendar's link is a secret: anyone holding it can read that calendar. It lives in Vault, is never readable by a client, and only links on Apple's iCloud hosts are accepted or followed, so the sync cannot be pointed at any other server.
- A feed has no sync token. Each read is whole, skipped when the server says it has not changed.
- Turning Public Calendar off breaks the link; the account then says so in Settings, as a Google account does when its consent is withdrawn.
