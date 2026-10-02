import { RefreshCwOff } from 'lucide-react';
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

// The time, large, and the Household's name over the date, in the Household Timezone. useNow redraws them on each
// minute and the moment Household midnight passes, so the minute turns on the minute and the date with no reload.
// Young Serif's digits are drawn in fixed-width cells (tabular-nums), and the width of the widest time is kept, so
// the clock never shifts as its digits change and the date beside it never moves when the hour gains or loses a
// digit. The date never shrinks and sets its column's width; the name takes that width and gives way, with an
// ellipsis, when it is longer.
function WallTime({ name, timezone }: { name: string; timezone: string }) {
  const now = useNow(timezone).getTime();
  const [time, period] = formatClock(now, timezone).split(/\s/);
  return (
    <>
      <p className="flex shrink-0 items-baseline gap-2">
        <span className="grid font-display text-[68px] leading-none tabular-nums">
          <span className="col-start-1 row-start-1">{time}</span>
          <span aria-hidden className="invisible col-start-1 row-start-1">
            00:00
          </span>
        </span>
        <span className="text-[22px] font-medium text-muted-foreground">{period}</span>
      </p>
      <div className="flex shrink-0 flex-col gap-0.5">
        <h1 className="w-0 min-w-full truncate text-sm leading-[18px] font-medium text-muted-foreground">{name}</h1>
        <p className="font-display text-[40px] leading-[44px] whitespace-nowrap">{formatDate(now, timezone)}</p>
      </div>
    </>
  );
}

// The "last synced N hours ago" mark: nothing while every Calendar Account is within an hour, so a healthy wall
// stays clean. A failed read keeps what the wall last knew.
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
    <p role="status" className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full bg-muted px-3.5 text-sm font-medium whitespace-nowrap">
      <RefreshCwOff aria-hidden className="size-[18px] shrink-0" />
      {badge}
    </p>
  );
}

// The Wall's header: the clock, the Household's name over the date, the weather, the Profile chips and the Offline
// and stale-sync marks. `household` is null until it has been read, `today` is its current Household date (null
// then too), and `chipsHidden` turns the chips off on a screen that is not a calendar.
//
// At 1280 px the header is 1136 px. The clock, the date, the weather and the marks never shrink and never overlap
// anything; what is left goes to the Profile chips, which scroll inside their own box when they do not fit, and
// the Household's name gives way inside the date's own column. The marks sit straight in the header, not in a
// wrapper, so that with none showing they cost no gap.
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
  const timezone = household?.timezone ?? null;
  return (
    <header className="flex h-21 items-center gap-6">
      {timezone && <WallTime name={household?.name ?? ''} timezone={timezone} />}
      {household && today && <WeatherNow forecast={forecast} unit={household.temperature_unit} today={today} />}
      <ProfileChips filter={filter} pressed={pressed} hidden={chipsHidden} />
      <ConnectionBadge compact />
      <SyncBadge />
    </header>
  );
}
