import { useEffect, useState } from 'react';
import { loadSyncFreshness, staleSyncBadge, type SyncFreshness } from '../lib/calendar-accounts';
import { formatClock, formatDate } from '../lib/calendar-occurrences';
import { useChangeTick } from '../lib/change-feed';
import type { Household } from '../lib/household';
import type { ProfileFilter } from '../lib/profile-filter';
import { supabase } from '../lib/supabase';
import { useNow } from '../lib/wall-hooks';
import type { Forecast } from '../lib/weather';
import { ConnectionBadge } from './ConnectionBadge';
import { ProfileChips } from './ProfileChips';
import { WeatherNow } from './Weather';

// How often the wall re-reads how fresh the mirror is, and re-words the badge as time passes.
const SYNC_FRESHNESS_MS = 60_000;

// What the sync badge listens to: a change to any of these tables reads it again.
const SYNC_TABLES = ['calendar_accounts', 'mirrored_calendars'] as const;

// The time, large, and the date beside it, in the Household Timezone. useNow redraws it on each minute
// and the moment Household midnight passes, so the minute turns on the minute and the date with no reload.
function WallClock({ timezone }: { timezone: string }) {
  const now = useNow(timezone).getTime();
  return (
    <p className="flex shrink-0 items-baseline gap-3">
      <span className="text-5xl font-semibold tabular-nums">{formatClock(now, timezone)}</span>
      <span className="text-2xl">{formatDate(now, timezone)}</span>
    </p>
  );
}

// The "last synced N hours ago" badge: nothing while every Calendar Account is within an hour,
// so a healthy wall stays clean. A failed read keeps what the wall last knew.
function SyncBadge() {
  const [accounts, setAccounts] = useState<SyncFreshness[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const changes = useChangeTick(SYNC_TABLES);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function read() {
      try {
        const next = await loadSyncFreshness(supabase);
        if (live) setAccounts(next);
      } catch {
        // Offline: keep the last reading.
      }
      if (!live) return;
      setNow(Date.now());
      timer = setTimeout(() => void read(), SYNC_FRESHNESS_MS);
    }
    void read();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [changes]);
  const badge = staleSyncBadge(accounts, now);
  if (!badge) return null;
  return (
    <p role="status" className="shrink-0 rounded-lg border border-border px-4 py-2 text-lg whitespace-nowrap">
      {badge}
    </p>
  );
}

// The Wall's header: the Household's name, the clock and date, the weather, the Profile chips and the
// Offline and stale-sync marks. `household` is null until it has been read, `today` is its current
// Household date (null then too), and `chipsHidden` turns the chips off on a screen that is not a calendar.
//
// At 1280 px the header is 1144 px, and that is all of it. The clock and date, the weather and the
// badges never shrink and never overlap anything; what is left goes to the Household's name and the
// Profile chips. The name gives way first (its shrink factor dwarfs the chips'), down to a few
// letters, and is capped at 15 rem so a long one never claims more than that; only then do the
// chips scroll inside their own box. The badges sit straight in the header, not in a wrapper, so
// that with none showing they cost no gap.
export function WallHeader({
  household,
  today,
  forecast,
  filter,
  pressed,
  chipsHidden,
}: {
  household: Household | null;
  today: string | null;
  forecast: Forecast | null;
  filter: ProfileFilter;
  pressed: readonly string[];
  chipsHidden: boolean;
}) {
  const name = household?.name ?? '';
  const timezone = household?.timezone ?? null;
  return (
    <header className="flex min-h-12 items-center gap-3">
      <h1 className={`max-w-60 shrink-[1000] truncate text-lg font-semibold ${name ? 'min-w-24' : ''}`}>{name}</h1>
      {timezone && <WallClock timezone={timezone} />}
      {household && today && <WeatherNow forecast={forecast} unit={household.temperature_unit} today={today} />}
      <ProfileChips filter={filter} pressed={pressed} hidden={chipsHidden} />
      <ConnectionBadge compact />
      <SyncBadge />
    </header>
  );
}
