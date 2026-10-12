---
status: accepted
date: 2026-10-12
---

# The Household's facts reach a screen as props, not through a context

The Wall's shell reads the Household once (its time zone, today, now, the Profiles) and hands those facts down to every screen as props; on the phone they travel five levels, from the shell to the day's event sheets. An architecture review on 2026-10-12 proposed one context for those facts, read where used, to shrink the screens' props. The owner rejected it: a context hides the interface it replaces. A screen whose props name what it needs can be read, rendered in a test and reasoned about alone; a screen that reads a context depends on something its interface does not say, and every static-markup test then needs a provider.

The Profile Filter is the one exception and stays one. It is pressed on the people strip and read by every calendar view, the Add event sheet and the day read, so it is a fact of the screen, not of the Household, and it crosses the shell by context.

## Consequences

- A screen's props stay explicit, even when a fact passes through a level that does not use it. Wide props are a sign to deepen the module below the screen (as the event sheet host does), not to reach past it.
- A second context needs its own ADR saying why it is a fact of the screen and not of the Household.
- Architecture reviews do not re-propose a Household context.
