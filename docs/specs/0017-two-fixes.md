# Nidus v16: two fixes

Tracker: GitHub issue #280; its sub-issues #281 and #282 are the tickets, one per section below and in its order. Vocabulary: [CONTEXT.md](../../CONTEXT.md) (Household, Device, Native Event, Meal, Shared List, Pinned List). Decisions: [PLAN.md](../PLAN.md) ("v16: two fixes"). The look: [look.md](../look.md) ("Overflow", "Type", "The phone", "Portrait", "A 24-inch screen").

## Problem Statement

A technical audit of the screens on 2026-10-28 scored them 18 of 20 and found two places where the Wall and the phone break the look's own rules.

- **A sheet on a narrower Wall scrolls without saying so.** The Wall's tablet draws no scrollbars, so wherever something scrolls it says so with the More foot. Every sheet hides that foot below 960 px wide, on the old reasoning that a sheet that narrow is on a phone, which scrolls by touch. Since v9 that is not so: the Lenovo Tab P12 hung upright is about 920 px wide at its default display size, and the Elo hung upright at 125 percent zoom is 864. On those Walls an event's long notes, the list a "+N" opens, the Add event sheet with a large family, the time sheet and the meal sheet can hold more than they show, and nothing says there is more.
- **The list chips' count is under the type floor.** On the phone's Lists tab each list chip says "N to get" at 13 px. The look's floor is 14 px; only the phone header's Household name and a Day chip's weekday are allowed 13.

## Solution

- A sheet shows its More foot wherever it is on the Wall, at any width. A sheet in the phone layout (below 768 px wide or 544 px tall) has none, since the phone scrolls by touch. The one rule that lays the Wall out for a phone decides it, as it decides the rest of the phone's look. 960 px stays the line between the Add event sheet's one column and its two, and nothing else.
- The list chip's count is 14 px, the floor.

## User Stories

1. As a parent at a Wall hung upright, I want an event's long notes to show the More foot, so that I know there is more to read.
2. As a parent at a portrait Wall, I want the list a "+N" opens to say when it holds more than it shows, so that I do not miss the events of a crowded hour.
3. As a parent adding a Native Event on a portrait Wall with a large family, I want the Add event sheet to show More when its fields run past the screen, so that I find the people and the Repeats below.
4. As a parent at a portrait Wall, I want the time sheet and the meal sheet to say when they scroll, so that every sheet behaves the same.
5. As a parent at the Elo hung upright at 125 percent zoom, I want the same foot as at 100 percent, so that zooming does not hide where a sheet scrolls.
6. As a parent at a Wall 960 px wide or wider, I want my sheets unchanged, so that the fix touches nothing that works.
7. As a parent on my phone, I want sheets to keep scrolling by touch with no More foot, so that the phone stays as it is.
8. As a parent with my phone on its side, I want its sheets to have no foot whatever its width, so that a wide phone is still a phone.
9. As someone using a keyboard or a screen reader at the Wall, I want the foot that now appears to be named for its sheet ("More of Piano", "Back to the top of Piano"), so that I hear what it moves.
10. As a parent typing in a field near the bottom of a sheet at a portrait Wall, I want the focused field scrolled clear of the new foot, so that the foot never covers what I am typing in.
11. As a parent tapping just above the new foot, I want the tap to do nothing, so that I never tick or open the item under its fade by accident.
12. As a parent at a portrait Wall, I want the Add event sheet to stay one column below 960 px and two from it, so that only the foot changes.
13. As a parent on the phone's Lists tab, I want "N to get" at the same size as every other caption, so that the count is as easy to read as the rest.
14. As a parent on the Lists tab, I want each chip to stay 56 px tall with its name, its pin and its count, so that the bigger count moves nothing.
15. As a parent on the Lists tab before the lists are read, I want the chips to still show no count rather than "0 to get", so that nothing says a list is empty when it is not known.
16. As someone who reads the look, I want look.md to say a sheet's foot is the Wall's at any width, so that the docs and the screen agree.

## Implementation Decisions

### 1. A sheet's More foot is the Wall's at any width

- The shared sheet body's foot is hidden by the phone layout's variant (`phone:`), the one rule that lays the Wall out for a phone, and no longer by a width of 960 px. Every sheet that uses the shared body gets it at once: an event's details, the list a "+N" opens, the Add and Edit event sheet, the time sheet and the meal sheet.
- The foot keeps everything else it has: its name from the sheet's title, "Back" at the end, the dead band over its fade, and the clearance that scrolls a focused field clear of it.
- 960 px stays only in the Add event sheet, for its one column or two and the rows that follow from that. Specs 0004 and 0009 mention 960 only for those columns and stand as written.
- look.md's Overflow paragraph says a sheet's body "has the foot, named for the sheet ("More of Piano", "Back to the top of Piano"), on the Wall at any width; a sheet in the phone layout scrolls by touch and has none." This replaces "on the Add event sheet it is the Wall's, from 960 px wide, since the phone's one column scrolls by touch."
- A phone on its side wider than 960 px (the phone layout by its height) loses the foot it shows today, which is what the phone's look says.

### 2. The list chip's count is 14 px

- The count under a list chip's name is 14 px on a 20 px line, its weight and colour unchanged. The chip stays 56 px tall: the name's line and the count's make 44.
- look.md is unchanged: the count now keeps to the Type table's floor ("Times, captions, rail words: 14, the smallest").

## Testing Decisions

- The seam is the one these parts already have: each is rendered to static markup with React's server renderer, and the test reads what the markup says. No new seam. Nothing here touches the database, so the Supabase seam is not involved.
- A good test asserts what a person sees or hears from the markup (the foot is drawn, what hides it, its name, the count's words and size), never a component's internals.
- **Sheet foot**: the sheet body's test that the foot is kept for the Wall is renamed for the new rule, and asserts the foot is hidden by the phone variant and that no 960 px rule hides it. Prior art: `tests/sheet.test.ts` ("a sheet's body").
- **List count**: the list chip's tests assert "4 to get" is drawn at 14 px. Prior art: `tests/phone-meals-lists.test.ts` (the list chip block).
- **Rendered check**, each ticket's last criterion: the real App bundle in headless Edge, as v9 and v10 were checked. At 920 by 1472, an event with long notes shows "More of" its title at its sheet's foot; at 390 by 844 the same sheet has no foot, and the Lists tab's chips show the count at 14 px inside 56 px. One round, and one confirming round at most.

## Out of Scope

- Splitting the bundle, with Settings and the join page loaded lazily. Measured on 2026-10-28 at about 4 percent of the source (about 10 KB gzipped of 226); react-dom and Supabase, which both sides need, are the bulk. Dropped.
- A whole-app polish pass. The audit's other findings held: the tokens, every touch target at 48 px or more, the sheets' dialog semantics, reduced motion.
- The other width rules inside the phone layout (the header's 420 and 360 px, the Day chips' 336). look.md sets them by width and they stand.
- An automated browser test of layout.
- The service worker, which is for push only and caches no pages.

## Further Notes

- The findings come from the audit on 2026-10-28 (Accessibility 4, Performance 3, Theming 4, Responsive 3, Implementation Integrity 4); every decision came out of the grilling that followed, every recommendation taken. Nothing in CONTEXT.md changed, and there is no ADR: each change is a one-line revert.
- Two tickets with no blockers between them, each its own pull request into `master` that closes its ticket. No migrations and no Edge Functions: Netlify's deploy on merge is the whole release.
- The audit said the service worker caches the bundle. It does not: it has no fetch handler, and the hashed assets are revalidated by Netlify's default ETag.
