// The iCloud adapter (spec 0008, 0005): an iPhone calendar account is read from its public link. The
// whole feed is fetched (_shared/feed.ts), skipped when the server says it has not changed (its
// validators), its repeats expanded into the same window (_shared/ics-expand.ts) and stored with the
// same replace_synced_events. It never touches Google's token endpoint. The adapter also holds the run's
// work budget: one step budget and one time limit for every feed of the run, since the hosted function
// has a 2 s CPU limit in all.
import type { EventRow } from '../_shared/event-row.ts';
import { fetchFeed } from '../_shared/feed.ts';
import { expandFeed, FeedTooLargeError, MAX_EXPANSION_MS, MAX_STEPS_PER_RUN, type StepBudget } from '../_shared/ics-expand.ts';
import { type Calendar, canReadIncrementally, type Outcome, type ProviderAdapter, replace, type SyncDeps, syncWindow } from './adapter.ts';

// What the sync writes in `last_error` for the logs: Settings words these from the account's status, provider and
// truncated flag, and never reads them.
const FEED_GONE_LOG = 'The feed link no longer works.';
// A feed that had the whole run and did not fit.
const FEED_TOO_LARGE_LOG = 'The calendar is too large to read within the run’s limits.';

// An iPhone calendar's validator, kept in its Mirrored Calendar's sync_token (no client can read
// it) as JSON: {"etag": "...", "lastModified": "..."}, either null, and `"truncated": true` when
// that read left some repeating events short, so that a 304 (the stored events are still the
// truth) keeps saying so. Anything else reads as none, so the feed is read in full.
export function encodeFeedValidators(etag: string | null, lastModified: string | null, truncated = false): string | null {
  return etag || lastModified ? JSON.stringify({ etag, lastModified, ...(truncated ? { truncated: true } : {}) }) : null;
}

function decodeFeedValidators(token: string | null): { etag: string | null; lastModified: string | null; truncated: boolean } {
  try {
    const parsed = JSON.parse(token ?? 'null') as { etag?: unknown; lastModified?: unknown; truncated?: unknown } | null;
    return {
      etag: typeof parsed?.etag === 'string' ? parsed.etag : null,
      lastModified: typeof parsed?.lastModified === 'string' ? parsed.lastModified : null,
      truncated: parsed?.truncated === true,
    };
  } catch {
    return { etag: null, lastModified: null, truncated: false };
  }
}

// Syncs iPhone calendar accounts: read the link from Vault, ask the feed whether it changed, and on a change
// expand it into the window and replace the Mirrored Calendar's events. Never throws, and never puts the link
// (or anything the feed said) in a note. One adapter serves a whole run, and so does its step budget.
export function icloudAdapter(deps: SyncDeps): ProviderAdapter {
  const run: StepBudget = { remaining: MAX_STEPS_PER_RUN, spentMs: 0, ...(deps.clock ? { now: deps.clock } : {}) };

  return {
    position: 1,
    leastRecentlyTriedFirst: true,
    async syncAccount({ account, timezone, nowMs, markAttempted }): Promise<Outcome> {
      // Decided before anything is written or read: a run with no steps or time left cannot read a feed at
      // all, not even to parse it. A calendar the run did not reach is untouched (no stamp, no note), so it
      // keeps its row and its place in line. A feed that does start and does not fit has been tried, and
      // goes to the back (below).
      if (run.remaining <= 0 || (run.spentMs ?? 0) >= MAX_EXPANSION_MS) return { kind: 'skipped' };

      // Before anything that can take long or kill the run: a feed that does so goes to the back of the
      // line next time. Whether this write lands is not the sync's business.
      await markAttempted();

      const { data: link, error: secretError } = await deps.admin.rpc('read_calendar_secret', { p_secret_id: account.vault_secret_id });
      if (secretError) return { kind: 'failed', note: 'Could not read the stored link.' };
      if (typeof link !== 'string') return { kind: 'needs_reauth', note: FEED_GONE_LOG };

      const { data: calendars, error: listError } = await deps.admin
        .from('mirrored_calendars')
        .select('id, google_calendar_id, name, selected, sync_token, last_full_sync_at')
        .eq('calendar_account_id', account.id)
        .eq('selected', true)
        .returns<Calendar[]>();
      if (listError || !calendars) return { kind: 'failed', note: 'Could not read the account’s calendars.' };

      // Deselected: it has no events and no business with the feed.
      const calendar = calendars[0];
      if (!calendar) return { kind: 'synced', truncated: false, read: { calendars: 0, events: 0 } };

      // As Google's incremental sync is dropped every FULL_SYNC_EVERY_MS, so is a validator: a feed
      // that keeps answering 304 would otherwise never be expanded past the window it was last read in.
      const validators = canReadIncrementally(calendar, nowMs) ? decodeFeedValidators(calendar.sync_token) : { etag: null, lastModified: null, truncated: false };
      const feed = await fetchFeed(link, validators, deps.fetch);
      if (feed.kind === 'gone') return { kind: 'needs_reauth', note: FEED_GONE_LOG };
      if (feed.kind === 'error') return { kind: 'failed', note: `Could not read the iPhone calendar (${feed.message}).` };
      if (feed.kind !== 'calendar') {
        // Not changed: the stored events are still the truth, so is whether they were cut short.
        return { kind: 'synced', truncated: validators.truncated, read: { calendars: 1, events: 0 } };
      }

      const window = syncWindow(nowMs);
      let truncated: boolean;
      let rows: EventRow[];
      // Whether this feed had the whole run to itself: only then does failing to fit say it is too big.
      const fresh = run.remaining === MAX_STEPS_PER_RUN && !run.spentMs;
      try {
        ({ rows, truncated } = expandFeed(feed.text, timezone, Date.parse(window.timeMin), Date.parse(window.timeMax), run));
      } catch (error) {
        // Not stored: replacing would delete the events the walk never reached. The old events and
        // validator stay, so the feed is read again next run.
        if (error instanceof FeedTooLargeError) {
          // It had the whole run and did not fit: it keeps its new stamp and goes to the back of the
          // line. One that had less than a whole run (feeds before it took the rest) has not shown it is
          // too big: it gets its old place back, and a whole run next time.
          return { kind: 'failed', note: FEED_TOO_LARGE_LOG, untried: !fresh };
        }
        return { kind: 'failed', note: 'Could not read the iPhone calendar (it is not a calendar the Wall can read).' };
      }
      try {
        await replace(deps.admin, calendar.id, rows, encodeFeedValidators(feed.etag, feed.lastModified, truncated), nowMs);
      } catch {
        return { kind: 'failed', note: 'Could not store the iPhone calendar’s events.' };
      }
      // It did sync: `truncated` says what was cut.
      return { kind: 'synced', truncated, read: { calendars: 1, events: rows.length } };
    },
  };
}
