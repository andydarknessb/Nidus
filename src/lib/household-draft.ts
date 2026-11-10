import type { Household } from './household';

// The Settings form as a draft over the Household as it is now (spec 0020, ticket 2): a field shows the Household's value until
// someone edits it, and a Save sends only the fields edited. Plain, so the rule is tested without a screen.
export type HouseholdDraft = { name?: string; timezone?: string };

// What each field shows: the edit when there is one, else the Household as it is now.
export function shownOf(household: Household, draft: HouseholdDraft): { name: string; timezone: string } {
  return { name: draft.name ?? household.name, timezone: draft.timezone ?? household.timezone };
}

// What a Save that landed leaves of the draft: the fields it sent, as they were sent, are forgotten; an edit made while it was on its
// way stays, so the words typed there are not taken away.
export function leftAfter(draft: HouseholdDraft, sent: { name?: string; timezone?: string }): HouseholdDraft {
  const left: HouseholdDraft = {};
  if (draft.name !== undefined && draft.name.trim() !== sent.name) left.name = draft.name;
  if (draft.timezone !== undefined && draft.timezone !== sent.timezone) left.timezone = draft.timezone;
  return left;
}

// What a Save sends: the edited fields only, the name trimmed. null when nothing was edited, and then nothing is written.
export function changesOf(draft: HouseholdDraft): { name?: string; timezone?: string } | null {
  const changes: { name?: string; timezone?: string } = {};
  if (draft.name !== undefined) changes.name = draft.name.trim();
  if (draft.timezone !== undefined) changes.timezone = draft.timezone;
  return Object.keys(changes).length > 0 ? changes : null;
}
