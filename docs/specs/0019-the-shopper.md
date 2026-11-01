# Nidus v18: the shopper

Tracker: opened from this spec once the owner approves it, one sub-issue per ticket ([docs/agents/issue-tracker.md](../agents/issue-tracker.md)). Vocabulary: [CONTEXT.md](../../CONTEXT.md) (Household, Household Account, Device, Profile, Shared List, Pinned List, List Suggestion, Usual, Meal, Household Date). Decisions: [PLAN.md](../PLAN.md) ("v18: the shopper"); the load-bearing one is [ADR 0007](../adr/0007-claude-suggests-the-assistant-shops.md). The look: [look.md](../look.md) ("The parts", "A sheet", "Overflow", "The phone").

## Problem Statement

The family plans the week's Meals on the Wall, keeps Groceries on a Shared List, and buys most of it at Target, usually by Drive Up. Working out what the Meals need happens in someone's head, and getting the list into a Target cart means typing it again, item by item, in Target's app. On 2026-11-01 the owner asked for an AI personal shopper that does both, with no copying and pasting.

Target has no public cart API. Its terms (updated 2026-03-22) admit only the AI shopping agents Target approves (ChatGPT, Google's Gemini and AI Mode, Microsoft Copilot), prohibit any other robot or agent, and count what an agent buys as the customer's own purchase. Of the three, Target documents fresh groceries and Drive Up only for its app inside ChatGPT. Nidus cannot fill a Target cart. It can write the list, and hand it to Target's app in ChatGPT.

## Solution

- **Suggest from meals.** A tap on a list, on the Wall or a phone, asks Claude for the groceries the Meals of the next seven days need, sized for the Household. They wait on the list as List Suggestions, on every screen, until someone adds or dismisses them.
- **Send to Target.** On a phone, a list's items to get, with the Usuals that match them, go to ChatGPT as one message asking Target's app to build a cart. ChatGPT opens with the message typed in; the person taps Send, checks the cart, chooses Drive Up and pays in Target.
- **Got it.** Nidus remembers what it sent. When the shopping is home, a tap on the Wall or a phone crosses off what came, and what did not come stays on the list.
- **Usuals.** The product the Household buys for an item ("milk" is a gallon of Good & Gather 2%), with a Target link when there is one, kept in Settings and sent with the list.

Nothing is copied or pasted, unless the phone cannot hand text to ChatGPT; then Copy is the way.

## User Stories

1. As a parent planning the week, I want groceries suggested from the next seven days of Meals, so that I do not work the list out in my head.
2. As a parent, I want the amounts sized for how many people we are ("Ground beef, 2 lb").
3. As a parent, I want a suggestion to leave out what the list already has, so that nothing is doubled.
4. As a parent, I want suggestions to wait on the list on every screen, so that I can start on my phone and finish at the Wall.
5. As a family member at the Wall, I want to ask for suggestions from the Lists screen too.
6. As a family member, I want to see which meals a suggestion is for ("For Tacos, Chili"), so that I can judge it.
7. As a family member, I want to add or dismiss one suggestion, or all of them, with one tap.
8. As a family member, I want a suggestion to look unlike an item by its outline and its heading, never by fading, so that the Wall stays readable from across the room.
9. As a parent, I want suggestions gone after a week, so that last week's never linger.
10. As a parent, I want asking again to replace the waiting suggestions, and to be told so before I ask, so that two sets never pile up.
11. As a parent, I want a daily limit on asking, so that a child tapping the Wall cannot run up a bill.
12. As a parent, I want to send the list to Target from my phone in two taps without copying, so that Target's app in ChatGPT builds the cart.
13. As a parent, I want the message to name our usual product for an item, so that the cart comes out right.
14. As a parent, I want the message to ask Target to check with me before swapping anything.
15. As a parent, I want to see the message before it goes.
16. As a parent whose phone cannot open ChatGPT with the text or share to it, I want Copy.
17. As whoever unpacks the shopping, I want to tap Got it on the Wall or my phone and cross off what came in one go, leaving on the list what did not come.
18. As a parent, I want items added after I sent the list left alone by Got it.
19. As a parent, I want to keep our Usuals in Settings: add, change and delete them, with a Target link when I have one.
20. As a family member, I want the list's "12 to get", the list notification and "Clear crossed off" to work as today, since a suggestion is not an item until it is added.
21. As someone using a screen reader, I want each suggestion's buttons named for the item and the list, and every sheet named.
22. As a parent, I want to know what leaves the house: meal names, list items and Usuals go to Anthropic, and ChatGPT gets only what I send it.

## Implementation Decisions

### Rulings (settled with the owner, 2026-11-01)

- **Target's app in ChatGPT fills the cart** ([ADR 0007](../adr/0007-claude-suggests-the-assistant-shops.md)). Nidus never signs in to Target, scrapes it or calls a cart service. ChatGPT, because Target documents fresh food and Drive Up there only. The message is plain text, so another assistant could take it unchanged.
- **Claude, for one job**: suggesting groceries from Meals. `claude-haiku-5-5` at effort `max` (owner), from the server only, in the Edge Function `shopper`.
- **Suggestions wait on the list as rows** (owner), over a review sheet that forgets them when it closes, and over writing items with an Undo.
- **Phone and Wall** (owner): Suggest from meals, adding and dismissing suggestions, and Got it on both. Send to Target in the phone layout only: a tablet has no ChatGPT and no Target sign-in. Usuals are written in the phone's Settings and read everywhere.
- **No copying or pasting** (owner). "Open in ChatGPT" opens ChatGPT with the message typed in, and the person taps Send. It ships only if the owner's check (Further Notes) finds that it opens the ChatGPT app with the text in its box; otherwise Share is the sheet's first control. Copy is always there.
- **No order is read back** (owner, with "no pasting"). Got it crosses off what was sent; Usuals are typed in. Nothing tells Nidus which product Target chose.
- **A Device gains two writes**: dismissing a List Suggestion, and an item's sent mark. This widens "A Device may write only Native Events, Routine Completions, list items, Meals and its own heartbeat" by exactly that. Adding a suggestion writes a list item, which a Device already may.
- **The limit**: 10 runs of the shopper per Household per Household Date, counted from Household midnight. A run counts once Nidus has asked Claude, whatever the answer.
- **Dropped**, with reasons in ADR 0007: Instacart's shopping-list API, OpenAI's API, a ChatGPT connector that reads Nidus, Target catalog scrapers, a robot that signs in to Target, and reading a pasted order with Claude.

### Data

One additive migration per ticket, each pushed to the hosted project before the pull request that reads it merges.

**The sent mark (ticket 1)**
- `list_items.sent_at timestamptz`, null when the item is not waiting for Got it. It joins the `authenticated` update column grant; the policies are unchanged.
- `mark_list_sent(p_list_id uuid) returns integer`, security invoker: in one statement sets `sent_at = now()` on the list's items that are not crossed off, and returns how many.
- `got_list_items(p_list_id uuid, p_came uuid[]) returns integer`, security invoker: in one statement over the list's items that are sent and not crossed off, sets `crossed_at = now()` on those in `p_came` and clears `sent_at` on the rest; returns how many it crossed off. Any other id in `p_came` is ignored.
- An item crossed off by hand keeps its `sent_at` but is no longer waiting, so Got it never shows it.

**List Suggestions (ticket 2)**
- `list_suggestions`: `id uuid` primary key, `list_id uuid` (references `shared_lists`, on delete cascade), `text` (1 to 200 characters once trimmed, the list item's rule), `for_meals` (null, or 1 to 120), `sort_order integer`, `created_at timestamptz default now()`.
- Grants: `select` and `delete` to `authenticated`, nothing else; no client creates or edits a suggestion. Policies: read and delete through the list's Household, as for `list_items`.
- `add_list_suggestions(p_ids uuid[]) returns setof list_items`, security invoker: in one statement deletes the given suggestions the caller may see and inserts a list item for each one deleted (its text; `sort_order` after the list's last item, in the suggestions' order; `added_by` the caller, by its default). A suggestion another screen added or dismissed first is not there to delete, so two taps make one item.
- `list_suggestions` joins the `supabase_realtime` publication. The nightly prune deletes suggestions more than 7 days old.
- A suggestion is not an item: `leftToGet`, the list notification, the Target message, Got it and Clear crossed off never read it.

**Runs (ticket 3)**
- `shopper_runs`: `id uuid` primary key, `household_id` (references `households`, on delete cascade), `ran_at timestamptz default now()`, indexed by Household and `ran_at`. No client grants. The nightly prune deletes runs more than 30 days old.
- `replace_list_suggestions(p_list_id uuid, p_items jsonb) returns integer`, security definer, executable by `service_role` only: locks the list's row (`for update`), deletes its suggestions and inserts the new ones in their order, in one transaction. Of two runs for one list at once, the second waits and then replaces.

**Usuals (ticket 4)**
- `usuals`: `id uuid` primary key, `household_id` (references `households`, on delete cascade), `name` (1 to 60 once trimmed), `product` (1 to 200), `target_link` (null, or at most 500 characters starting `https://www.target.com/p/`), `created_at`. Unique per Household on the name ignoring case and runs of spaces.
- Grants: `select` to `authenticated`; `insert` (household_id, name, product, target_link), `update` (name, product, target_link) and `delete` to `authenticated`. Policies: principals of the Household read; only a Household Account of the Household (`is_household_account()`) writes.
- `usuals` joins the `supabase_realtime` publication.

### The shopper: Edge Function `shopper` (ticket 3)

- `supabase/functions/shopper/`, an `index.ts` for Deno and a `handler.ts` the tests drive under Node, `verify_jwt = false`, as the other three. The secret `ANTHROPIC_API_KEY` goes in `supabase/.env.example`, and hosted by `supabase secrets set`.
- `POST { list_id }` with the session's bearer token, from a phone or the Wall.
- Who: a new `principalOf(request, admin)` in `_shared/edge.ts` gives the Household of a Household Account or a paired Device: 401 without a session, 403 for anyone else. The list must be the Household's (403).
- In order:
  1. No key: 503 `not-set-up`.
  2. Count the Household's runs since Household midnight (`_shared/zoned-time.ts`). At 10: 429 `limit`.
  3. Read the Meals of today and the next six Household Dates (title, weekday, slot). None: 200 `no-meals`, and no run.
  4. Read the list's items that are not crossed off, the Usuals' names and products (from ticket 4; none before it), and the number of Profiles (at least 1).
  5. Insert a run, then ask Claude.
  6. Check the answer, then `replace_list_suggestions`.
- The request: `@anthropic-ai/sdk` (Deno: `npm:@anthropic-ai/sdk` in the function's `deno.json`; Node: a package dependency). `model: 'claude-haiku-5-5'`, `output_config: { effort: 'max', format: <the schema> }`, streamed and read whole with `finalMessage()`, `max_tokens: 64000`, no `temperature`, `top_p` or `top_k`. Nidus stops waiting at 120 seconds (Supabase answers 504 at 150). The client is made with the handler's injected `fetch`, which is the fake in tests.
- The schema: `{ items: [{ text: string, for_meals: string }] }`, at most 40 items.
- The instructions: one grocery item per entry with an amount for the number of people ("Ground beef, 2 lb"); only what the Meals need; nothing the list already has, and no salt, pepper, cooking oil or water; a Usual's name when the item is one; no brands; `for_meals` names the Meals the item is for. The Meals, the items and the Usuals come after the instructions, as data.
- The check: trim with `set_meal`'s whitespace set; keep 1 to 200 characters, and `for_meals` cut to 120 (null when blank); drop an item whose words equal an item's on the list or an earlier one's, ignoring case and runs of spaces; keep the first 40. None left: 200 `nothing-new`, and the waiting suggestions stay as they were. Otherwise `replace_list_suggestions`, and 200 `suggested` with the count.
- An error, the 120 seconds, `stop_reason` `refusal` or `max_tokens`, or a body that is not the schema: 502 `failed`. Nothing changes and the run still counts. Haiku 5.5 has no server-side fallback model.
- Facts, not sentences (v8's ruling): the function answers `outcome` (and `count`), and the screens word it.
- What a run sends Anthropic: the Meals' titles with their weekday and slot, the list's items to get, the Usuals, and the number of Profiles. Never a person's name, an event, a Routine or the Household's name.

### The screens

**The list card** (`ListCard`, on the Wall's Lists screen and the phone's Lists tab; every list, not only the Pinned List)
- After the items, the heading "Suggested from meals" (15 px, `--muted-foreground`), then the suggestions in their order, as one group of that name. Each is a row: its words in `--foreground` with "For Tacos, Chili" under them in `--muted-foreground`, a 1.5 px dashed `--input` ring and no fill (an item has its fill), then Add (a plus, named "Add {text} to {list}") and Dismiss (a cross, named "Dismiss {text}"), each 48 px. Under the rows, "Add all {n}" (secondary) and "Dismiss all" (quiet). On the Wall in landscape they scroll with the items, under the card's More foot.
- At the card's foot, beside "Clear crossed off": "Suggest from meals" (quiet on the Wall, secondary on a phone). While it waits it reads "Looking at your meals" and cannot be pressed. With suggestions waiting it reads "Suggest again", over "This replaces the {n} waiting."
- The outcomes are said at the card's foot, where a failure already is: `no-meals` "No meals planned for the next 7 days."; `nothing-new` "Nothing to add. {list} already has it all."; `limit` "Suggest from meals has been used 10 times today. Try again tomorrow."; `failed` "Couldn't make suggestions. Try again."; `not-set-up` "The shopper isn't set up yet." On `suggested` the rows appear, and the status line says "{n} suggestions for {list}."
- With items waiting for Got it (sent and not crossed off): the line "Sent to Target at 5:02 PM: {n} items", where {n} counts them and the time is the latest `sent_at` in the Household Timezone, and "Got it" (secondary), on the Wall and a phone.
- In the phone layout only: "Send to Target" (secondary), while the list has items to get.

**Home** (the Wall's Pinned List card and the phone's Home list)
- Under the items: "{n} suggestions waiting", a link to the Lists screen at that list, and "Sent to Target: {n}" with "Got it", which opens the Got it sheet. Each only when it applies.

**The Send to Target sheet** (phone layout)
- Title "Send to Target". The message in a block that scrolls and cannot be edited. Then "Open in ChatGPT" (primary; only by the owner's check, and only while its link is at most 8,000 characters), "Share" (only where `navigator.share` exists) and "Copy" (status "Copied"). Under them: "Check the cart in Target before you pay."
- The message, the list's items to get in their order, then the Usuals whose name is in an item (ignoring case, as whole words), with no Usuals block when none is:

  ```
  Target, please build a cart with these items:
  - Milk
  - Ground beef, 2 lb

  Use our usual product when one fits:
  - milk: Good & Gather 2% milk, 1 gallon (https://www.target.com/p/...)

  Ask me before swapping anything.
  ```

- "Open in ChatGPT" goes to `https://chatgpt.com/?q=` and the message, encoded.
- `mark_list_sent` runs when "Open in ChatGPT" is pressed, when the share sheet says it shared, or when Copy succeeded. Closing the share sheet marks nothing.

**The Got it sheet** (Wall and phone)
- Title "Got it?". The items waiting for Got it (sent and not crossed off), in the list's order, each a 48 px row with a tick, all ticked. "Cross off {n}" (primary) calls `got_list_items` with the ticked ones; Close changes nothing. On the Wall the sheet has its More foot when it overflows.

**Usuals** (a card in the phone's Settings)
- Each Usual is a row: its name, its product and "Target link" when it has one, with Edit and Delete. "Add a usual" opens Name, Product and Target link (optional). The one form row of v13: the asked-for words, the busy guard, the problem's place and the focus return.
- Empty: "No usuals yet. Add the products you always buy." A link that is not a Target product: "Paste a link from Target's app or target.com." A name that is taken: "You already have a usual for {name}."

### Tickets (each its own pull request into `master`, in this order)

1. **Send to Target and Got it.** The sent-mark migration, the Send to Target sheet, the sent line and Got it on the list card and Home, and the message as a pure core. No AI. The owner's check comes before it.
2. **List Suggestions.** The suggestions migration (table, `add_list_suggestions`, Realtime, prune), the suggestions on the list card, and Home's line.
3. **Suggest from meals.** The runs migration (`shopper_runs`, `replace_list_suggestions`, prune), the `shopper` function, `principalOf`, and the button with its words. Blocked by 2.
4. **Usuals.** The usuals migration, the Settings card, and the Usuals in the message (ticket 1) and in the instructions (ticket 3). Blocked by 1 and 3.

### Deploy

- Each migration reaches the hosted project before its pull request merges (PLAN.md's order since v2).
- Ticket 3: push the migration, set `ANTHROPIC_API_KEY` with `supabase secrets set`, deploy `shopper`, then merge. Without the key the screens say "The shopper isn't set up yet." and nothing else changes.
- The hosted steps are Cory's.

## Testing Decisions

- As now: Vitest, the local stack as a real principal (a Household Account, a Device, anonymous), and never a mocked database. Anthropic's API is the one new fake, injected as the shopper's `fetch`, beside Google's API, the iCloud feeds and the push service. A good test asserts what a person sees or what the database holds, never a function's internals.
- **The shopper** (`tests/shopper.test.ts`): a Household Account and a Device get suggestions; an unpaired session, a stranger and another Household's list are refused; no Meals means no request to Claude and no run; the eleventh run of a Household Date is refused, and the count restarts at Household midnight, not UTC midnight; the check drops an item the list has (in any case), a repeat, a blank and one over 200 characters, and keeps 40; an error, a refusal, the time limit and a wrong shape change nothing and count the run; asking again replaces the waiting suggestions, and two runs at once leave one set; `nothing-new` leaves the waiting suggestions; the request names `claude-haiku-5-5` and effort `max`, and carries no Profile's name, no event and no Routine.
- **Data**: both principals read and dismiss their Household's suggestions, neither inserts or updates one, and another Household sees none; `add_list_suggestions` called twice at once makes one item, at the end of the list, with `added_by` the caller; deleting a list deletes its suggestions. `mark_list_sent` marks only items not crossed off; `got_list_items` crosses off the ones that came, clears the rest, and ignores other ids and items added after the send. A Household Account writes Usuals, a Device reads them and cannot write; a taken name (in any case or spacing) and a link that is not a Target product are refused. The nightly prune deletes week-old suggestions and month-old runs (`tests/nightly-prune.test.ts`). The list notification never names a waiting suggestion and names an added one to the other phones (`tests/push-notify.test.ts`).
- **Pure cores**: the Target message (only the items to get; only Usuals named in an item, as whole words; no Usuals block without one; the link's length) and the outcomes' words.
- **Cards**, through `renderToStaticMarkup` (prior art: `tests/list-card.test.ts`, `tests/notifications-section.test.ts`): suggestions with their heading, words, meals and named buttons; the count leaves them out; the sent line and Got it; Send to Target only in the phone layout; the Usuals card.
- **By hand**: the owner's check before ticket 1, and the whole loop on Cory's phone after ticket 3 is deployed. Agents do not put a session token into a browser.

## Out of Scope

- Filling a Target cart, or any shop's cart, from Nidus itself (ADR 0007).
- Reading an order or a receipt back, and learning Usuals from one.
- Suggestions from anything but Meals: recipes, the pantry, past lists.
- Suggesting on a schedule, and a notification for waiting suggestions.
- Prices, stock, totals or product search in Nidus.
- Send to Target from the Wall.
- Choosing Drive Up, pickup or delivery in Nidus; Target's checkout does that.
- Naming an assistant but ChatGPT on a button.

## Further Notes

- The owner's check, on his phone, before ticket 1 starts: (1) Share from Nidus offers ChatGPT, and ChatGPT opens with the text; (2) `https://chatgpt.com/?q=` opens the ChatGPT app, not the browser, with the text in its box (it is not documented by OpenAI and never sends by itself); (3) Target's app builds a cart from a short message, keeps "milk: Good & Gather 2% milk, 1 gallon", and asks before swapping. (1) and (2) decide the sheet's first control; (3) may change only the message's words.
- What the owner needs from ChatGPT: the app, signed in, with Target connected once (Settings, Apps & Connectors, Target, then Target's sign-in), and a Target account with a store and a card. No OpenAI key and no Developer Mode. OpenAI lists apps on its Free plan but says some need Plus; whether Target's does was not established.
- Research on 2026-11-01 behind the rulings: Target's app in ChatGPT (beta since November 2025: several items in one cart, fresh food, Drive Up, Order Pickup, shipping); Target in Google's Gemini and AI Mode on the Universal Commerce Protocol, with shipping documented; Target Circle linked in Microsoft Copilot from April 2026; OpenAI ended its own Instant Checkout in March 2026, so a purchase finishes in the retailer's own flow; Target's terms of 2026-03-22.
- Cost: Haiku 5.5 is $0.10 a million tokens in and $0.50 out under 100K tokens of prompt (Anthropic's prices as of 2026-10), so a run at effort `max` is about one to two cents, and the limit holds a day under about 20 cents.
- Four tickets, ordered by "blocked by"; each closes in its own pull request.
- CONTEXT.md gains List Suggestion and Usual, and its Shared List says what being sent means. CLAUDE.md's Device rule and test seam change with this spec.
- The Meal itself stays free text (v2): what changes is that Nidus may suggest groceries from it. [skylight-comparison.md](../skylight-comparison.md)'s "Skip" on AI meal plans and ingredients to the grocery list is taken up only as far as ingredients to the list.
