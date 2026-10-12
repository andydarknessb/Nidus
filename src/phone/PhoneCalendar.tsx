import { useContext, useState } from 'react';
import { BeforeHousehold } from '../components/BeforeHousehold';
import { DayView } from '../components/FiveDayCalendar';
import { statusLineClass } from '../components/phone';
import { describeMonth } from '../lib/calendar-occurrences';
import { navigationRailDate, type WallRoute } from '../lib/wall-routes';
import { CALENDAR_LIMITS, canOpenDay, type CalendarView, type PagingWindow, type WallDay } from '../lib/paged-view';
import { pageWords, pickedDay } from '../lib/phone-calendar';
import { ProfileFilterContext } from '../lib/profile-filter';
import type { Profile } from '../lib/profiles';
import { usePagedView } from '../lib/use-paged-view';
import { useNow, useDayEvents } from '../lib/wall-hooks';
import type { PhoneScreenProps } from '../PhoneWall';
import { DayEvents } from './DayEvents';
import { DayChips, Pager, PhoneCard, Segmented } from './parts';
import { PhoneMonth } from './PhoneMonth';
import { householdDay } from '../../supabase/functions/_shared/zoned-time.ts';

// The phone's Calendar tab (docs/specs/0004-the-wall-on-a-phone.md, Screens, Calendar): under the people strip, which the shell draws,
// a control of three (Day, Week, Month) and a pager, then the view for one day at a time. The control changes the address as the
// navigation rail's entries do (navigationRailDate), and the pager turns pages by the same routes and dates as the tablet's paging
// row (paging), so Back works. Every event is read by the tablet's own readers (useDayEvents, through the Profile filter): no new query.

const VIEWS: readonly { value: CalendarView; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

// The Day view's box: the hours it shows are the whole hours that fit between its Earlier and Later rows, so it is given a height. It is
// the screen's height less about 26.5 rem for what is above it (the header, the strip, the control and the pager) and below (the bar,
// Add event and the gaps), and never under 36 rem, which holds eight hours. On a screen shorter than that the box keeps its 36 rem and
// the document scrolls past it, as the phone's column does everywhere else.
const DAY_BOX = 'h-[max(36rem,calc(100svh-26.5rem))]';

export function PhoneCalendar({ route, timezone, view, added, profiles, openView }: PhoneScreenProps & { route: Extract<WallRoute, { view: CalendarView }> }) {
  if (!timezone) return <BeforeHousehold label="Calendar" failed={view.failed} of="the calendar" />;
  return <Calendar timezone={timezone} route={route} added={added} profiles={profiles} openView={openView} />;
}

function Calendar({
  timezone,
  route,
  added,
  profiles,
  openView,
}: {
  timezone: string;
  route: Extract<WallRoute, { view: CalendarView }>;
  added: number;
  profiles: Profile[] | null;
  openView: (view: CalendarView, date: string) => void;
}) {
  const now = useNow(timezone);
  const { touch } = useContext(ProfileFilterContext);
  const calendarView = route.view;
  // The page, and focus on its words (usePagedView): paging may switch off the button that was pressed, so focus goes to the words when it
  // was lost, and stays on the button when a person pages by keyboard. It never moves when the tab opens, which would scroll the page.
  const { today, window, anchor, days, previous, next, limit, heading } = usePagedView({
    view: calendarView,
    date: route.date,
    now,
    timezone,
    limits: CALENDAR_LIMITS,
    takesFocusOnArrival: false,
    preventScroll: true,
  });

  return (
    // A touch anywhere in the calendar keeps the Profile filter open.
    <div className="contents" onPointerDownCapture={touch}>
      <Segmented label="Calendar view" options={VIEWS} value={calendarView} onChange={(chosen) => openView(chosen, navigationRailDate(chosen, route, householdDay(timezone).date))} />
      <Pager
        words={days ? pageWords(days, today) : describeMonth(anchor)}
        headingRef={heading}
        previousLabel={`Previous ${calendarView}`}
        nextLabel={`Next ${calendarView}`}
        onPrevious={previous === null ? null : () => openView(calendarView, previous)}
        onNext={next === null ? null : () => openView(calendarView, next)}
      />
      {/* Always mounted, so a screen reader announces the text when it appears. */}
      <p role="status" className={`${statusLineClass} text-muted-foreground`}>
        {limit}
      </p>
      {/* Keyed on the view and the page, so a turned page, or the other view starting on the same day, never shows the last page's events. */}
      {calendarView === 'week' && days ? (
        <PhoneWeek key={`week:${anchor}`} timezone={timezone} now={now} today={today} anchor={anchor} window={window} days={days} version={added} profiles={profiles} />
      ) : calendarView === 'day' && days ? (
        <div className={`flex flex-col ${DAY_BOX}`}>
          <DayView
            key={`day:${anchor}`}
            timezone={timezone}
            now={now}
            day={days[0]!}
            version={added}
            profiles={profiles}
            focusHeading={() => heading.current?.focus()}
          />
        </div>
      ) : (
        <PhoneMonth key={`month:${anchor}`} timezone={timezone} now={now} today={today} anchor={anchor} window={window} version={added} profiles={profiles} />
      )}
    </div>
  );
}

// Week: seven day chips, the picked day's full date and its events. The picked day is today when the week holds it, else the Sunday; it
// is this screen's own state (not part of the address), and the screen is keyed on the week, so a turned page starts again.
function PhoneWeek({
  timezone,
  now,
  today,
  anchor,
  window,
  days,
  version,
  profiles,
}: {
  timezone: string;
  now: Date;
  today: string;
  anchor: string;
  window: PagingWindow;
  days: WallDay[];
  version: number;
  profiles: Profile[] | null;
}) {
  const [pick, setPick] = useState<string | null>(null);
  const picked = pick ?? pickedDay('week', anchor, timezone, now);
  const events = useDayEvents(days, version, profiles);
  return (
    <PhoneCard label="Calendar">
      <DayChips label="Days of this week" dates={days.map((day) => day.date)} today={today} picked={picked} onPick={setPick} canPick={(date) => canOpenDay(date, window)} />
      <DayEvents
        day={days.find((day) => day.date === picked) ?? days[0]!}
        events={events}
        beyond={!canOpenDay(picked, window)}
        profiles={profiles}
        now={now}
        timezone={timezone}
      />
    </PhoneCard>
  );
}
