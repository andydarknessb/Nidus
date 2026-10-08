// What the calendar sync's run and its providers' adapters share (spec 0008). The run takes one
// adapter per provider, with one operation: sync this account. The adapter reads the provider and
// stores what it reads; it answers with an Outcome and never writes the Calendar Account's row. The run
// alone does that, from the Outcome, and it alone orders the accounts.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EventRow } from '../_shared/event-row.ts';

export type SyncEnv = {
  // Shared with the pg_cron job (Vault secret calendar_sync_secret). Long and random.
  syncSecret: string;
  googleClientId: string;
  googleClientSecret: string;
};

export type SyncDeps = {
  env: SyncEnv;
  // The service role: it reads Vault secrets and is the only writer of synced_events.
  admin: SupabaseClient;
  fetch: typeof fetch;
  // Epoch milliseconds; injectable so the window and last_synced_at are testable.
  now?: () => number;
  // Milliseconds for the run's time limit on expanding feeds (performance.now by default);
  // injectable so the limit is testable.
  clock?: () => number;
  // Sync only this Household's accounts. The scheduled run leaves it unset (every Household);
  // the tests set it so they never touch another run's accounts on a shared local stack.
  householdId?: string;
};

export type Account = { id: string; household_id: string; vault_secret_id: string; provider: 'google' | 'icloud'; last_attempted_at: string | null };

// What an adapter read before it stopped: the Mirrored Calendars it synced and the events it stored.
export type Read = { calendars: number; events: number };

// How syncing one account went.
//   synced        it was read; `truncated` says some repeating events were cut short by the work limits.
//   failed        it was tried and did not work; `note` is for the logs. `untried` says it never had a whole run
//                 to itself, so it was not really tried and keeps its place in line.
//   needs_reauth  the provider no longer honours the account (a revoked sign-in, a link that is gone): only a
//                 person connecting it again helps, so the run leaves it alone until then.
//   skipped       the run did not reach it; nothing was read or written, its row stays as it was.
export type Outcome =
  | { kind: 'synced'; truncated: boolean; read: Read }
  | { kind: 'failed'; note: string; read?: Read; untried?: boolean }
  | { kind: 'needs_reauth'; note: string }
  | { kind: 'skipped' };

export type AccountToSync = {
  account: Account;
  timezone: string;
  nowMs: number;
  // Writes the "tried at" stamp that orders the accounts. An adapter calls it before anything that can take
  // long or kill the run, once it knows it will not skip.
  markAttempted: () => Promise<void>;
};

export type ProviderAdapter = {
  // Its place among the providers in a run: lower goes first, so a slow provider can never keep another
  // from syncing in the same run.
  position: number;
  // Whether its accounts go least recently tried first (never tried first), so the same ones cannot always
  // take the run and starve a later one. Otherwise by id.
  leastRecentlyTriedFirst: boolean;
  // Never throws: whatever goes wrong is an Outcome.
  syncAccount(job: AccountToSync): Promise<Outcome>;
};

export class SyncFailure extends Error {}

export type Window = { timeMin: string; timeMax: string };

// Recurring events are stored as occurrences inside this window only (PLAN.md: Calendar).
export function syncWindow(nowMs: number): Window {
  return { timeMin: addMonths(nowMs, -1), timeMax: addMonths(nowMs, 6) };
}

// `ms` moved by whole calendar months (UTC), stopping at the end of a shorter month rather than
// spilling into the next: Mar 31 less a month is Feb 28, not Mar 3.
function addMonths(ms: number, months: number): string {
  const at = new Date(ms);
  const target = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(at.getUTCDate(), lastDay));
  target.setUTCHours(at.getUTCHours(), at.getUTCMinutes(), at.getUTCSeconds(), at.getUTCMilliseconds());
  return target.toISOString();
}

// How long a calendar may go on being read incrementally: a Google sync token, or an iPhone feed's
// validator, is dropped after this and the calendar is read in full again.
export const FULL_SYNC_EVERY_MS = 24 * 60 * 60 * 1000;

export type Calendar = {
  id: string;
  google_calendar_id: string;
  name: string;
  selected: boolean;
  sync_token: string | null;
  last_full_sync_at: string | null;
};

// Whether the calendar can be read incrementally: it has a token and was read in full recently.
export function canReadIncrementally(calendar: Calendar, nowMs: number): calendar is Calendar & { sync_token: string } {
  if (!calendar.sync_token || !calendar.last_full_sync_at) return false;
  const age = nowMs - Date.parse(calendar.last_full_sync_at);
  return age >= 0 && age < FULL_SYNC_EVERY_MS;
}

// Replaces a calendar's events in one transaction, so a failure never leaves half a mirror.
export async function replace(admin: SupabaseClient, calendarId: string, rows: EventRow[], syncToken: string | null, nowMs: number): Promise<void> {
  const { error } = await admin.rpc('replace_synced_events', {
    p_mirrored_calendar_id: calendarId,
    p_events: rows,
    p_sync_token: syncToken,
    p_synced_at: new Date(nowMs).toISOString(),
  });
  if (error) throw new SyncFailure('could not store events');
}
