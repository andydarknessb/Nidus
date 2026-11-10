// One Synced Event row as replace_synced_events takes it. Each provider hands over the facts it reads
// (its key, title, notes, place, the two instants and all day); eventRow applies the rules every row
// shares: the default title, the caps on words, the ISO instants and the refusals. Google's adapter
// (calendar-sync/google-adapter.ts) and an iPhone calendar's feed (ics-expand.ts) both build rows here.
export type EventRow = {
  google_event_id: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  is_all_day: boolean;
};

export const MAX_TITLE = 500;
export const MAX_LOCATION = 500;
export const MAX_DESCRIPTION = 8000;

// The title an event with none is given. The merge SQL (calendar_occurrences, migration 20261025000001)
// recognises it by these words, lower-cased, so a change here goes there too.
export const DEFAULT_TITLE = '(No title)';

export type EventFacts = {
  // The provider's key for the row (google_event_id keeps its name, as v8 ruled).
  key: string;
  title: string | null | undefined;
  notes: string | null | undefined;
  place: string | null | undefined;
  startsMs: number;
  endsMs: number;
  allDay: boolean;
};

// The row for `facts`, or null when an instant is not a real time or the end falls before the start.
export function eventRow(facts: EventFacts): EventRow | null {
  const { startsMs, endsMs } = facts;
  if (!Number.isFinite(startsMs) || !Number.isFinite(endsMs) || endsMs < startsMs) return null;
  return {
    google_event_id: facts.key,
    title: (facts.title?.trim() || DEFAULT_TITLE).slice(0, MAX_TITLE),
    description: facts.notes ? facts.notes.slice(0, MAX_DESCRIPTION) : null,
    location: facts.place ? facts.place.slice(0, MAX_LOCATION) : null,
    starts_at: new Date(startsMs).toISOString(),
    ends_at: new Date(endsMs).toISOString(),
    is_all_day: facts.allDay,
  };
}
