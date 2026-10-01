# Nidus

A wall-mounted family calendar and organizer for a single household, shown on a tablet running as a kiosk. Mirrors the household's external calendars and adds household-only routines and lists.

## Language

### People & tenancy

**Household**:
The tenant. One family, one shared wall display, one timezone. Every record belongs to exactly one Household.
_Avoid_: Family, tenant, nest, account

**Household Account**:
The single sign-in identity (Google sign-in) that owns a Household and administers it. Not a person to attribute things to.
_Avoid_: User, login, admin

**Profile**:
A person in the Household, used for attribution and colour-coding. Has no credentials.
_Avoid_: User, member, account, kiosk

**Device**:
A screen (the wall tablet, a phone, a computer's browser) paired to a Household so it can show the display without a sign-in. It may read everything, tick Routines and list items, and manage Native Events, but never administer the Household. A Device is not a Profile.
_Avoid_: Kiosk profile, terminal, tablet (a tablet is one kind of Device)

**Pairing Code**:
The six-character code an unpaired screen shows so a Household Account can claim it and turn it into a Device. Expires after 10 minutes; single use.
_Avoid_: PIN, token, invite

**Household Timezone**:
The one timezone stored on the Household. All display, rollover and reset logic uses it; source calendar timezones are converted on ingest.

### Display

**Wall**:
The Household's shared display of its calendar, Routines and Shared Lists, shown to a Device or the Household Account on any screen. On a wide screen it is the five-day home screen with its rail; on a phone, the same content one section at a time.
_Avoid_: Kiosk, dashboard, display (the home screen is one view of the Wall, not the Wall itself)

### Calendar

**Calendar Account**:
An external calendar provider connection (v1: Google only) belonging to the Household, from which events are mirrored.
_Avoid_: Integration, connection, OAuth account

**Mirrored Calendar**:
One selected calendar within a Calendar Account that Nidus mirrors. Carries the Profile (or whole-Household) attribution that its Synced Events inherit.
_Avoid_: Sub-calendar, feed, source

**Synced Event**:
One occurrence of an event mirrored read-only from a Mirrored Calendar. Recurring events arrive already expanded into occurrences. Nidus never edits or writes it back.
_Avoid_: External event, imported event

**Native Event**:
An event created in Nidus that exists only in Nidus and is never pushed to any provider.
_Avoid_: Local event, manual event

### Tasks & lists

**Routine**:
A habit owned by one Profile on a days-of-week schedule. It resets to unchecked at Household midnight regardless of whether it was done.
_Avoid_: Habit, daily task, chore

**Routine Completion**:
A record that a Profile completed a Routine on a given Household date. Kept after the midnight reset.
_Avoid_: Check, tick, history entry

**Shared List**:
A named household-wide list of text items (e.g. Groceries) anyone can add to or cross off. Crossed items remain visible until cleared.
_Avoid_: Todo list, checklist

**Pinned List**:
The one Shared List a Household shows on the home screen's rail (`households.pinned_list_id`). A new Household starts with Groceries pinned; only the Household Account changes it. The other lists open from the tablet's Lists screen.
_Avoid_: Favourite list, default list
