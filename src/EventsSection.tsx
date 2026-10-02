import { Pin, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { HouseDisc, PersonDisc } from './components/people';
import { Card } from './components/phone';
import { Button } from './components/ui/button';
import { NativeEventSheet } from './components/NativeEventSheet';
import { describeWhen, type Occurrence } from './lib/calendar-occurrences';
import type { Household } from './lib/household';
import { loadUpcomingNativeEvents } from './lib/native-events';
import { eventPeople, loadProfiles, namesInWords, type Profile } from './lib/profiles';
import { householdDay } from './lib/routines';
import { supabase } from './lib/supabase';
import { useRefetchOn } from './lib/change-feed';

const EVENT_TABLES = ['native_events', 'native_event_profiles', 'profiles'] as const;

// Who an event is for, as discs: the whole Household's is the house, one person's is theirs, two are both, and more than two are
// the first and a count of the rest. The words are for a screen reader, which hears no disc.
function Who({ profileIds, profiles }: { profileIds: string[]; profiles: Profile[] }) {
  const { everyone, people } = eventPeople(profileIds, profiles);
  const shown = people.length > 2 ? people.slice(0, 1) : people;
  const more = people.length - shown.length;
  return (
    <span className="flex shrink-0 items-center">
      <span className="sr-only">For {everyone ? 'everyone' : namesInWords(people.map((person) => person.name))}</span>
      {everyone && <HouseDisc size={34} />}
      {shown.map((person, index) => (
        <span key={person.id} className={index > 0 ? '-ml-1' : ''}>
          <PersonDisc name={person.name} color={person.color} size={34} />
        </span>
      ))}
      {more > 0 && (
        <span aria-hidden className="-ml-1 flex size-[34px] items-center justify-center rounded-full bg-accent text-sm leading-none font-semibold text-foreground">
          +{more}
        </span>
      )}
    </span>
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

  return (
    <Card title="Events added in Nidus">
      <p className="text-base leading-6">Events added here and on the Wall live only in Nidus. They are not in Google Calendar.</p>
      <Button variant="secondary" size="phone" className="w-full" onClick={() => setSheet({})}>
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
            <Button variant="secondary" className="h-auto min-h-14 w-full justify-start gap-3 rounded-[14px] px-3.5 py-2 text-left font-medium whitespace-normal" onClick={() => setSheet({ occurrence: event })}>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-start gap-2 text-[17px] leading-6 font-medium">
                  <Pin aria-hidden className="mt-1 size-4 shrink-0" />
                  <span className="min-w-0 break-words">{event.title}</span>
                </span>
                <span className="text-sm leading-5 font-normal text-muted-foreground">{describeWhen(event, household.timezone)}</span>
              </span>
              <Who profileIds={event.profile_ids} profiles={profiles} />
            </Button>
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
            void refresh();
          }}
        />
      )}
    </Card>
  );
}
