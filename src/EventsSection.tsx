import { Pin, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { EventDiscs } from './components/EventPill';
import { Card } from './components/phone';
import { Button } from './components/ui/button';
import { NativeEventSheet } from './components/NativeEventSheet';
import { describeWhen, type Occurrence } from './lib/calendar-occurrences';
import type { Household } from './lib/household';
import { loadUpcomingNativeEvents } from './lib/native-events';
import { loadProfiles, type Profile } from './lib/profiles';
import { listNames, pillPeople } from './lib/schedule';
import { supabase } from './lib/supabase';
import { couldNotLoad, useSyncedRead } from './lib/synced-read';
import { householdDay } from '../supabase/functions/_shared/zoned-time.ts';

const EVENT_TABLES = ['native_events', 'native_event_profiles', 'profiles'] as const;
const NO_PROFILES: Profile[] = [];

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
  // Read through the synced read: every 30 seconds, 5 after a failure, and when an event or a Profile changes.
  const read = useSyncedRead(
    async () => {
      const [events, profiles] = await Promise.all([loadUpcomingNativeEvents(supabase, new Date()), loadProfiles(supabase)]);
      return { events, profiles };
    },
    EVENT_TABLES,
    'events',
  );
  const events = read.data?.events ?? null;
  const profiles = read.data?.profiles ?? NO_PROFILES;
  // The sheet: a new event, or the one being edited.
  const [sheet, setSheet] = useState<{ occurrence?: Occurrence } | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  // How many times the sheet has closed on a write and the list been read again since.
  const [settled, setSettled] = useState(0);

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
      {read.failed && (
        <p role="alert" className="text-base">
          {couldNotLoad('events')}
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
          profiles={profiles}
          date={householdDay(household.timezone).date}
          {...(sheet.occurrence ? { occurrence: sheet.occurrence } : {})}
          onClose={() => setSheet(null)}
          onSaved={() => {
            setSheet(null);
            void read.readBack().then(() => setSettled((count) => count + 1));
          }}
        />
      )}
    </Card>
  );
}
