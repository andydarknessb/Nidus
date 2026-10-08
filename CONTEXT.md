# Nidus

A wall-mounted family calendar and organizer for a single household, shown on a tablet or a touch screen running as a kiosk. Mirrors the household's external calendars and adds household-only routines and lists.

## Language

### People & tenancy

**Household**:
The tenant. One family, one shared wall display, one timezone. Every record belongs to exactly one Household.
_Avoid_: Family, tenant, nest, account

**Household Account**:
A sign-in identity (Google sign-in) that administers a Household. A Household has one or more, all with the same rights; the first makes the Household, and others join only by a Household Invite. A Google account is a Household Account of at most one Household. Not a person to attribute things to.
_Avoid_: User, login, admin, owner, member

**Profile**:
A person in the Household, used for attribution and colour-coding. Has no credentials.
_Avoid_: User, member, account, kiosk

**Device**:
A tablet, or a PC's browser driving a touch screen, paired to a Household so it can show the display without a sign-in. It may read everything, tick Routines and list items, plan Meals, and manage Native Events, but never administer the Household. A Device is not a Profile.
_Avoid_: Kiosk profile, terminal

**Pairing Code**:
The six-character code an unpaired tablet shows so a Household Account can claim it and turn it into a Device. Expires after 10 minutes; single use.
_Avoid_: PIN, token, invite

**Household Invite**:
The single-use link a Household Account makes so another grown-up can sign in with their own Google account and become a Household Account of the same Household. Lasts 7 days; one at a time per Household, so making a new one ends the old.
_Avoid_: Pairing Code, share code, membership

**Push Subscription**:
One browser on one phone, signed in as a Household Account, that has turned on notifications. It holds the browser's Web Push endpoint and which of the four kinds that phone gets (event reminders, morning summary, Routines not done, added to the list). It belongs to its Household Account and goes when that account is removed. A Device never has one.
_Avoid_: device (a Device is a tablet or a screen's PC), token, registration

**Household Timezone**:
The one timezone stored on the Household. All display, rollover and reset logic uses it; source calendar timezones are converted on ingest.

**Appearance**:
How the Household wants the Wall to look: Auto (light from sunrise to sunset, dark otherwise), Light or Dark. The Household Account sets it. A screen's own switch overrides it on that screen until the next sunrise or sunset; that override is not stored on the Household.
_Avoid_: Theme, skin, dark mode

### Calendar

**Calendar Account**:
An external calendar source belonging to the Household, from which events are mirrored: a Google account (by its consent), or one iCloud calendar (by its public link). Its `provider` says which.
_Avoid_: Integration, connection, OAuth account

**Mirrored Calendar**:
One selected calendar within a Calendar Account that Nidus mirrors. Carries the Profile (or whole-Household) attribution that its Synced Events inherit.
_Avoid_: Sub-calendar, feed, source

**Synced Event**:
One occurrence of an event mirrored read-only from a Mirrored Calendar. Recurring events are stored as expanded occurrences (Google expands them; an iCloud feed's rules are expanded by the sync). Nidus never edits or writes it back.
_Avoid_: External event, imported event

**Native Event**:
An event created in Nidus that exists only in Nidus and is never pushed to any provider.
_Avoid_: Local event, manual event

### Tasks & lists

**Routine**:
A habit owned by one Profile on a days-of-week schedule, optionally placed in a time of day (morning, afternoon or evening) and given a picture from the app's fixed set, so a child who cannot read can tell it apart. It resets to unchecked at Household midnight regardless of whether it was done.
_Avoid_: Habit, daily task, chore

**Routine Completion**:
A record that a Profile completed a Routine on a given Household date. Kept after the midnight reset.
_Avoid_: Check, tick, history entry

**Shared List**:
A named household-wide list of text items (e.g. Groceries) anyone can add to or cross off. Crossed items remain visible until cleared.
_Avoid_: Todo list, checklist

**Pinned List**:
The one Shared List a Household shows on the home screen's rail (`households.pinned_list_id`). A new Household starts with Groceries pinned; only the Household Account changes it. Every list, the Pinned List first, is on the Wall's Lists screen.
_Avoid_: Favourite list, default list

### Meals

**Meal**:
What the Household plans to eat for one slot (breakfast, lunch, dinner or snack) on one Household date. Free text, at most one per slot per day; the Household Account or a Device writes, changes or clears it.
_Avoid_: Recipe, menu, meal plan entry
