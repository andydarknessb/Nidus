---
status: accepted
date: 2026-11-01
---

# Claude suggests the groceries, and Target's app in ChatGPT fills the cart

The owner asked for an AI personal shopper: the week's Meals turned into a grocery list, and the list turned into a Target cart with no retyping and no pasting. Target has no public cart API. Its terms (updated 2026-03-22) admit only the shopping agents Target approves (ChatGPT, Google's Gemini and AI Mode, Microsoft Copilot), prohibit any other robot or agent, and count what an agent buys as the customer's own purchase. Of the three, Target documents fresh groceries and Drive Up only for its app inside ChatGPT.

So the shopper is two halves that never meet on a server. Nidus asks Claude (`claude-haiku-5-5`, effort `max`), from the Edge Function `shopper`, for the groceries the next seven days of Meals need, and shows them on the list as List Suggestions that a person adds or dismisses. A phone hands the list, with the Usuals that match it, to ChatGPT as one plain message, opening the ChatGPT app with the text typed in; Target's app there builds the cart, and the person sends it, checks the cart and pays in Target. When the shopping is home, Got it crosses off what was sent.

PLAN.md dropped AI twice: "inbound email AI" in v1, and "no recipes, no AI" for the v2 meal plan. This takes it up for one job, groceries from Meals. The Meal itself stays free text.

We rejected a robot that signs in to target.com as the family (Target's terms prohibit it, and it puts the account at risk); Target catalog scrapers sold as APIs (Target's terms prohibit scraping, and Target's app already has the live catalog, prices and stock); OpenAI's API in Nidus (its models cannot reach ChatGPT's apps or a Target account, so it would do Claude's job and nothing more); a ChatGPT connector that reads the list from Nidus (Developer Mode, ChatGPT only, and reported to break the other apps in the same chat); Instacart's shopping-list API, which fills an Instacart cart in one tap, Target included, but at Instacart's prices and fees, with no Drive Up or Target Circle, and behind Instacart's review of the app; and Claude reading a pasted order back (the owner wants no pasting).

## Consequences

- The message is plain text, and only its first word ("Target,") is addressed to anyone. If Target's grocery support moves to Gemini or Copilot, a button's words change and the design does not.
- What would reopen this: Target opening agent checkout (Google's Universal Commerce Protocol, which Target helped write) to apps other than the big platforms. Nidus could then fill the cart itself.
- Nidus's server talks to Anthropic. A run sends the Meals' titles with their weekday and slot, the list's items to get, the Usuals and the number of Profiles, and nothing else of the Household. Runs are limited to 10 per Household per Household Date, because anyone at the Wall can start one and each one costs money.
- ChatGPT gets only the message a person sends from a phone. Nidus's server never talks to OpenAI.
- Nidus does not learn which product Target chose for an item; Usuals are typed in.
- A Device gains two writes: dismissing a List Suggestion, and an item's sent mark.
