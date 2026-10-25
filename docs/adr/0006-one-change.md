---
status: accepted
date: 2026-10-24
---

# A screen changes the Household's data through one change, and says a failure at a place

Every screen that writes meets the same four questions: whether a write is already on its way, what it writes, what the screen shows until the read follows, and what it says when the write did not go through. Three answers had grown. The Settings cards and the event form passed a place to the change (`read.change(place, work, then)`). The Routines and Lists pages wrapped it in a page-wide `change(work, failure)` with one failure string. The Meal sheet kept its own `busy` and `problem` flags. The guard, the read-back and the words were re-decided at each, and the wrappers were untested: only the change itself is driven by a test.

An architecture review on 2026-10-24 found the three answers, and the owner approved one. The Household's data changes through one interface: `change(place, work, then)`, with the guard, the write, the read-back, the places and the words behind it. Every action names a place: a field, a row, or the page's own line for an action with no row of its own (`reorder`). A page keeps no page-wide string for a write. The module is `src/lib/change.ts`; the read stays in `src/lib/synced-read.ts` and composes it; the guard (`card-write.ts`) is no longer a module of its own. A screen that only writes (the Household's name, the Appearance, the weather, joining, the Meal sheet) still calls `useChange()` with no read.

## Consequences

- A new write is added by naming its place, not by inventing another way to be busy or another string to say.
- A failure is said where the person is looking: at the field, under the row, or in the page's line for an action that has no row.
- A write's words have one home (`write-failure.ts`) and one caller (`change`); a card that words a refusal or an action that is not a save passes its words through the change.
- Architecture reviews do not re-propose splitting the guard out of the change, or a page-wide failure string for a write.
- The read's own failure is not the change's: a card or a screen still says that its read failed, in the read's words (`couldNotLoad`, `ReadState`, `Card`).
