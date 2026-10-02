import { Pin, Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EventDiscs } from './components/EventPill';
import { Card } from './components/phone';
import { Button } from './components/ui/button';
import { NativeEventSheet } from './components/NativeEventSheet';
import { describeWhen, type Occurrence } from './lib/calendar-occurrences';
import type { Household } from './lib/household';
import { loadUpcomingNativeEvents } from './lib/native-events';
import { loadProfiles, type Profile } from './lib/profiles';
import { householdDay } from './lib/routines';
import { listNames, pillPeople } from './lib/schedule';
import { supabase } from './lib/supabase';
import { useRefetchOn } from './lib/change-feed';

const EVENT_TABLES = ['native_events', 'native_event_profiles', 'profiles'] as const;

// One event of the list: its title with the pin of a Native Event, when it is, and who it is for as the discs of the Wall's own
// pill (the house for the whole Household, a disc for one or two people, a disc and "+N" for more), which a screen reader hears
// as words instead. Who an event is for is pillPeople's rule, the one the schedule draws its fill from.
export function EventRow({ event, profiles, timezone, onOpen }: { event: Occurrence; profiles: readonly Profile[]; timezone: string; onOpen: () => void }) {
  const people = pillPeople(event, profiles);
  return (
    <Button variant="secondary" className="h-auto min-h-14 w-full justify-start gap-3 rounded-[14px] px-3.5 py-2 text-left font-medium whitespace-normal" onClick={onOpen}>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-start gap-2 text-[17px] leading-6 font-medium">
          <Pin aria-hidden className="mt-1 size-4 shrink-0" />
          <span className="min-w-0 break-words">{event.title}</span>
        </span>
        <span className="text-sm leading-5 font-normal text-muted-foreground">{describeWhen(event, timezone)}</span>
      </span>
      <span className="sr-only">For {people.kind === 'everyone' ? 'everyone' : listNames(people.names)}</span>
      <EventDiscs people={people} />
    </Button>
  );
}

// The phone's Native Events: what is coming up, to add, edit or delete from anywhere. The same sheet as the Wall's. Native Events
// are invisible in Google Calendar (ADR 0002), so the phone shows them here, on the Calendars page.
export function EventsSection({ household }: { household: Household }) {
  const [events, setEvents] = useState<Occurrence[] | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [failed, setFailed] = useState(false);
  // The sheet: a new event, or the one being edited.
  const [sheet, setSheet] = useState<{ occurrence?: Occurrence } | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  // How many times the sheet has closed on a write and the list been read again since.
  const [settled, setSettled] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const [found, people] = await Promise.all([loadUpcomingNativeEvents(supabase, new Date()), loadProfiles(supabase)]);
      setEvents(found);
      setProfiles(people);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useRefetchOn(EVENT_TABLES, () => void refresh());

  // The sheet gives the focus back to what opened it, and an event that was deleted took that row with it when the list was read
  // again: focus never falls to the page, it goes to Add event.
  useEffect(() => {
    if (settled === 0) return;
    const active = document.activeElement;
    if (!active || active === document.body) addButton.current?.focus();
  }, [settled]);

  return (
    <Card title="Events added in Nidus">
      <p className="text-base leading-6">Events added here and on the Wall live only in Nidus. They are not in Google Calendar.</p>
      <Button ref={addButton} variant="secondary" size="phone" className="w-full" onClick={() => setSheet({})}>
        <Plus aria-hidden />
        Add event
      </Button>
      {failed && (
        <p role="alert" className="text-base">
          Could not load events. Check your connection.
        </p>
      )}
      {events?.length === 0 && <p className="text-base">Nothing coming up.</p>}
      <ul className="flex flex-col gap-2">
        {events?.map((event) => (
          <li key={event.id}>
            <EventRow event={event} profiles={profiles} timezone={household.timezone} onOpen={() => setSheet({ occurrence: event })} />
          </li>
        ))}
      </ul>
      {sheet && (
        <NativeEventSheet
          timezone={household.timezone}
          date={householdDay(household.timezone).date}
          {...(sheet.occurrence ? { occurrence: sheet.occurrence } : {})}
          onClose={() => setSheet(null)}
          onSaved={() => {
            setSheet(null);
            void refresh().then(() => setSettled((count) => count + 1));
          }}
        />
      )}
    </Card>
  );
}
