// Mirroring external calendars into Synced Events (issues #7 and #8, spec 0005, spec 0008). One
// request syncs every active Calendar Account. Each provider brings one adapter with one operation,
// sync this account (google-adapter.ts, icloud-adapter.ts); this run chooses the adapter, orders the
// accounts, and alone writes the account's row from the Outcome the adapter answers with. A plain
// request handler with no Deno globals and no ambient network, so the tests drive it under Node with an
// injected `fetch` returning canned provider responses and a real service role client against the
// local stack. index.ts is the only Deno-specific file.
//
// Who calls it: pg_cron every five minutes (public.invoke_calendar_sync), or a person
// running it by hand (docs/calendar-sync.md). Either way the `x-sync-secret` header is the
// whole authority; there is no user session.
//
// One account failing never stops the others; an account its provider no longer honours is marked
// needs_reauth and left alone until the parent connects it again.
import { json, sameSecret } from '../_shared/edge.ts';
import { type Account, type Outcome, type ProviderAdapter, type SyncDeps } from './adapter.ts';
import { googleAdapter } from './google-adapter.ts';
import { icloudAdapter } from './icloud-adapter.ts';

export type { SyncDeps, SyncEnv } from './adapter.ts';

export type SyncSummary = { accounts: number; calendars: number; events: number; errors: string[] };

// Writes the account's row from how syncing it went: the one place a Calendar Account is written by the sync.
async function writeOutcome(deps: SyncDeps, account: Account, outcome: Outcome, nowMs: number, summary: SyncSummary): Promise<void> {
  if (outcome.kind === 'skipped') return;
  if (outcome.kind === 'synced') {
    summary.calendars += outcome.read.calendars;
    summary.events += outcome.read.events;
    // It did sync: the account stays active and last_synced_at moves; `truncated` says what was cut.
    await deps.admin.from('calendar_accounts').update({ last_synced_at: new Date(nowMs).toISOString(), last_error: null, truncated: outcome.truncated }).eq('id', account.id);
    return;
  }
  summary.errors.push(`${account.id}: ${outcome.note}`);
  if (outcome.kind === 'needs_reauth') {
    await deps.admin.from('calendar_accounts').update({ last_error: outcome.note, status: 'needs_reauth' }).eq('id', account.id);
    return;
  }
  summary.calendars += outcome.read?.calendars ?? 0;
  summary.events += outcome.read?.events ?? 0;
  // A feed that never had a whole run to itself has not shown it is too big: it gets its old place back.
  await deps.admin
    .from('calendar_accounts')
    .update({ last_error: outcome.note, ...(outcome.untried ? { last_attempted_at: account.last_attempted_at } : {}) })
    .eq('id', account.id);
}

export async function syncAll(deps: SyncDeps): Promise<SyncSummary> {
  const nowMs = (deps.now ?? Date.now)();
  const summary: SyncSummary = { accounts: 0, calendars: 0, events: 0, errors: [] };

  let query = deps.admin.from('calendar_accounts').select('id, household_id, vault_secret_id, provider, last_attempted_at').eq('status', 'active');
  if (deps.householdId) query = query.eq('household_id', deps.householdId);
  const { data: accounts, error } = await query.returns<Account[]>();
  if (error || !accounts) {
    summary.errors.push('could not list calendar accounts');
    return summary;
  }
  if (accounts.length === 0) return summary;

  const { data: households } = await deps.admin
    .from('households')
    .select('id, timezone')
    .in('id', [...new Set(accounts.map((account) => account.household_id))])
    .returns<{ id: string; timezone: string }[]>();
  const timezones = new Map((households ?? []).map((household) => [household.id, household.timezone]));

  // Made for this run: an adapter may hold what the whole run shares (the iCloud adapter's work budget).
  const adapters: Record<Account['provider'], ProviderAdapter> = { google: googleAdapter(deps), icloud: icloudAdapter(deps) };

  // The providers go in their own order, so that a slow one can never keep another from syncing in the same run.
  // Among the accounts of one that asks for it, the one tried longest ago (or never) goes first, then by id, so the
  // same ones cannot always take the run and starve a later one. Tried, not read: a feed that kills the run has
  // still been tried, and goes to the back.
  const attemptedAt = (account: Account) => (account.last_attempted_at ? Date.parse(account.last_attempted_at) : -Infinity);
  const byId = (a: Account, b: Account) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  accounts.sort((a, b) => {
    const [first, second] = [adapters[a.provider], adapters[b.provider]];
    if (first !== second) return first.position - second.position;
    if (first.leastRecentlyTriedFirst) {
      const [x, y] = [attemptedAt(a), attemptedAt(b)];
      if (x !== y) return x < y ? -1 : 1;
    }
    return byId(a, b);
  });
  for (const account of accounts) {
    const timezone = timezones.get(account.household_id);
    if (!timezone) {
      summary.errors.push(`${account.id}: household timezone unknown`);
      continue;
    }
    summary.accounts += 1;
    const outcome = await adapters[account.provider].syncAccount({
      account,
      timezone,
      nowMs,
      // Before anything that can take long or kill the run. Whether this write lands is not the sync's business.
      markAttempted: async () => {
        await deps.admin.from('calendar_accounts').update({ last_attempted_at: new Date(nowMs).toISOString() }).eq('id', account.id);
      },
    });
    await writeOutcome(deps, account, outcome, nowMs, summary);
  }
  return summary;
}

export async function handleCalendarSync(request: Request, deps: SyncDeps): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'POST only' });
  const given = request.headers.get('x-sync-secret');
  if (!given || !sameSecret(given, deps.env.syncSecret)) return json(401, { error: 'not allowed' });
  return json(200, await syncAll(deps));
}
