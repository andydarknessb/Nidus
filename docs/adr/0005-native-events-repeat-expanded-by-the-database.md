---
status: accepted
date: 2026-10-13
---

# Native Events repeat, and the database expands them when they are read

PLAN.md dropped repeating Native Events twice ("a repeating event belongs in Google"). The household's own things have no home in Google: a child's practice, a lesson, custody weeks. On 2026-10-13 the owner reversed the decision for those, with a small set of shapes (every N days, weeks on chosen weekdays, months on the same date, years; until a date or forever), and chose where the occurrences come from.

The Repeat is four columns on the Native Event, and the `calendar_occurrences` view expands it into Occurrences as it is read, from the Household's clock, two years ahead and all the way back to the first day. The days a person deleted or changed on their own are rows in a skips table the view leaves out. No job rolls a window, no rows are written for days that have not come, and every reader of the view (the Wall, the phone, the month, the push reminders) sees the same Occurrences without knowing a Repeat exists.

The alternatives were to write a row per Occurrence in a rolling window, as the mirror does for Synced Events, which needs a job to roll the window and a rule for a series edited after its rows are written; or to expand on the client, which the push reminders in the Edge Function could not see.

ADR 0002 stands: the mirror is read-only, Synced Events are stored as expanded Occurrences and Nidus never parses an RRULE string. A Repeat is not an RRULE; it is columns with four shapes, and nothing here touches `synced_events`.

## Consequences

- An Occurrence of a Repeat has an id of its own, derived from the event and its start, and carries the event's id beside it. Code that edits or deletes a Native Event uses the event's id, never the Occurrence's.
- The view does the arithmetic on every read. A Household has a handful of Repeats, each at most a few hundred Occurrences in two years, which is nothing; a Household with hundreds of daily Repeats would be the moment to write rows instead.
- A time that the clocks skip moves forward by the gap and one that happens twice is the first, as the glossary says of a Household Date; the view honours it, not Postgres's default for the second.
- "This and the ones after" is not a shape. It is done by ending a Repeat and starting another, and can be added as a shortcut later without a schema change.
