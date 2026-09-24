---
status: accepted
date: 2026-09-24
---

# Nidus mirrors external calendars read-only and never writes back

Synced Events are a one-way copy from Google Calendar, polled every five minutes with Google's incremental sync token. Events created on the wall are Native Events that live only in Nidus. We rejected two-way sync because conflict resolution between a wall edit and a phone edit is the hardest part of the product, and the household already has a good editor for Google events in their pockets. The Google OAuth scope is therefore `calendar.readonly`.

## Consequences

- A Native Event is invisible on phones. If that turns out to matter, the path is a single Nidus-owned Google calendar that Native Events are pushed to, not general two-way sync.
- Recurring events are stored as expanded occurrences in a rolling window; Nidus never parses RRULEs.
