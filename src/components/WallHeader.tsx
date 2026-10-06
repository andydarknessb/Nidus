import { RefreshCwOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { loadSyncFreshness, staleSyncBadge, staleSyncShort, type SyncFreshness } from '../lib/calendar-accounts';
import { formatClock, formatDate } from '../lib/calendar-occurrences';
import { useChangeTick } from '../lib/change-feed';
import type { Household } from '../lib/household';
import { supabase } from '../lib/supabase';
import { useNow } from '../lib/wall-hooks';
import type { Forecast } from '../lib/weather';
import { HeaderNextMeal } from '../MealsPage';
import { ConnectionBadge } from './ConnectionBadge';
import { PHONE_PILL_WORD } from './phone-pill';
import { WeatherNow } from './Weather';

// How often the wall re-reads how fresh the mirror is, and re-words the badge as time passes.
const SYNC_FRESHNESS_MS = 60_000;

// What the sync badge listens to: a change to any of these tables reads it again.
const SYNC_TABLES = ['calendar_accounts', 'mirrored_calendars'] as const;

// The time, large, and the Household's name over the date, in the Household Timezone. useNow redraws them on each
// minute and the moment Household midnight passes, so the minute turns on the minute and the date with no reload.
// The display face's figures are lining and tabular (font-display), so every digit is one width and the time does not
// shift from minute to minute. The time starts at the header's edge, in line with the card under it; what follows moves
// by one digit only when the hour gains or loses one, twice a day. The date never shrinks. Their column is as wide as
// the longer of the name and the date while the header has the room, and gives way down to the date's width when it does
// not: the name may break anywhere, so the least the column can be is the date, and its one line then ends in an ellipsis.
export function WallTime({ name, timezone }: { name: string; timezone: string }) {
  const now = useNow(timezone).getTime();
  const [time, period] = formatClock(now, timezone).split(/\s/);
  return (
    <>
      <p className="flex shrink-0 items-baseline gap-2">
        <span className="font-display text-[68px] leading-none">{time}</span>
        <span className="text-[22px] font-medium text-muted-foreground">{period}</span>
      </p>
      <div className="flex flex-col gap-0.5">
        <h1 className="line-clamp-1 text-sm leading-[18px] font-medium wrap-anywhere text-muted-foreground">{name}</h1>
        <p className="font-display text-[40px] leading-[44px] whitespace-nowrap">{formatDate(now, timezone)}</p>
      </div>
    </>
  );
}

// The "last synced N hours ago" mark: nothing while every Calendar Account is within an hour, so a healthy wall
// stays clean. A failed read keeps what the wall last knew.
//
// `compact` is the phone's header's form: the icon and a short age ("3 h"), the sentence for a screen reader only. `initial` is
// what it holds before its first read lands, which a test gives it; the Wall passes none, and reads at once.
export function SyncBadge({ compact = false, initial }: { compact?: boolean; initial?: { accounts: SyncFreshness[]; now: number } | undefined }) {
  const [accounts, setAccounts] = useState<SyncFreshness[]>(initial?.accounts ?? []);
  const [now, setNow] = useState(() => initial?.now ?? Date.now());
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
  if (compact) {
    return (
      <p role="status" data-pill="" className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-muted px-2.5 text-sm font-medium whitespace-nowrap">
        <RefreshCwOff aria-hidden className="size-[18px] shrink-0" />
        <span aria-hidden className={PHONE_PILL_WORD}>
          {staleSyncShort(accounts, now)}
        </span>
        <span className="sr-only">{badge}</span>
      </p>
    );
  }
  return (
    <p role="status" className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full bg-muted px-3.5 text-sm font-medium whitespace-nowrap">
      <RefreshCwOff aria-hidden className="size-[18px] shrink-0" />
      {badge}
    </p>
  );
}

// The Wall's header: the clock, the Household's name over the date, the weather and the Offline and stale-sync marks.
// `household` is null until it has been read and `today` is its current Household date (null then too).
//
// At 1280 px the header is 1136 px. The clock, the date, the weather and the marks never shrink and never overlap
// anything. What is left goes to the next meal (HeaderNextMeal), the header's one flexible box, which keeps the marks at
// the far right whether or not it draws anything; `onMeals` opens Meals, and is null on the Meals screen, where the meal
// is not drawn. When room runs out the next meal's words give way first, then the button goes, and only then does the
// Household's name give way, down to the date's width (WallTime). The marks sit straight in the header, not in a wrapper,
// so that with none showing they cost no gap.
export function WallHeader({ household, today, forecast, onMeals }: { household: Household | null; today: string | null; forecast: Forecast | null; onMeals: (() => void) | null }) {
  const timezone = household?.timezone ?? null;
  return (
    <header className="flex h-21 items-center gap-6">
      {timezone && <WallTime name={household?.name ?? ''} timezone={timezone} />}
      {household && today && <WeatherNow forecast={forecast} unit={household.temperature_unit} today={today} />}
      <HeaderNextMeal timezone={timezone} onOpen={onMeals} />
      <ConnectionBadge compact />
      <SyncBadge />
    </header>
  );
}
