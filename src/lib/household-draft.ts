import type { Household } from './household';

// The Settings form as a draft over the Household as it is now (spec 0020, ticket 2): a field shows the Household's value until
// someone edits it, and a Save sends only the fields edited. Plain, so the rule is tested without a screen.
export type HouseholdDraft = { name?: string; timezone?: string };

// What each field shows: the edit when there is one, else the Household as it is now.
export function shownOf(household: Household, draft: HouseholdDraft): { name: string; timezone: string } {
  return { name: draft.name ?? household.name, timezone: draft.timezone ?? household.timezone };
}

// What a Save sends: the edited fields only, the name trimmed. null when nothing was edited, and then nothing is written.
export function changesOf(draft: HouseholdDraft): { name?: string; timezone?: string } | null {
  const changes: { name?: string; timezone?: string } = {};
  if (draft.name !== undefined) changes.name = draft.name.trim();
  if (draft.timezone !== undefined) changes.timezone = draft.timezone;
  return Object.keys(changes).length > 0 ? changes : null;
}
