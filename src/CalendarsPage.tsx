import { CalendarAccountsSection } from './CalendarAccountsSection';
import { EventsSection } from './EventsSection';
import { PhonePage } from './components/phone';
import type { Household } from './lib/household';

// The phone's Calendars page (/settings/calendars): the Google calendars the Wall mirrors, and the events added in Nidus.
export function CalendarsPage({ household }: { household: Household }) {
  return (
    <PhonePage title="Calendars">
      <CalendarAccountsSection />
      <EventsSection household={household} />
    </PhonePage>
  );
}
