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
A person in the Household, used for attribution and colour-coding. Has no credentials beyond an optional PIN.
_Avoid_: User, member, account, kiosk

**Device**:
A tablet paired to a Household so it can show the display without a sign-in. A Device is not a Profile.
_Avoid_: Kiosk profile, terminal

**Household Timezone**:
The one timezone stored on the Household. All display, rollover and reset logic uses it; source calendar timezones are converted on ingest.

### Calendar

**Calendar Account**:
An external calendar provider connection (v1: Google only) belonging to the Household, from which events are mirrored.
_Avoid_: Integration, connection, OAuth account

**Synced Event**:
An event mirrored read-only from a Calendar Account. Nidus never edits or writes it back.
_Avoid_: External event, imported event

**Native Event**:
An event created in Nidus that exists only in Nidus and is never pushed to any provider.
_Avoid_: Local event, manual event

### Tasks & lists

**Routine**:
A fixed daily habit that resets to unchecked at Household midnight regardless of whether it was done.
_Avoid_: Habit, daily task, chore

**Shared List**:
A household-wide list of items (e.g. groceries) anyone can add to or cross off.
_Avoid_: Todo list, checklist
