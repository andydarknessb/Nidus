// One Synced Event row as replace_synced_events takes it, and how long its words may be. Shared
// by Google's rows (calendar-sync/handler.ts) and an iPhone calendar's (ics-expand.ts), so the
// two cut a title, a place and notes alike.
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
