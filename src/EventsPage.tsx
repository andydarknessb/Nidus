import { Pin } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { NativeEventSheet } from './components/NativeEventSheet';
import { describeWhen, type Occurrence } from './lib/calendar-occurrences';
import type { Household } from './lib/household';
import { loadUpcomingNativeEvents } from './lib/native-events';
import { householdDay } from './lib/routines';
import { supabase } from './lib/supabase';

const action = 'min-h-12 rounded-lg px-4 text-base font-medium';

// The phone's Native Events: what is coming up, to add, edit or delete from anywhere. The same
// sheet as the wall's. Native Events are invisible in Google Calendar (ADR 0002), so the phone
// shows them here.
export function EventsPage({ household }: { household: Household }) {
  const [events, setEvents] = useState<Occurrence[] | null>(null);
  const [failed, setFailed] = useState(false);
  // The sheet: a new event, or the one being edited.
  const [sheet, setSheet] = useState<{ occurrence?: Occurrence } | null>(null);

  const refresh = useCallback(async () => {
    try {
      setEvents(await loadUpcomingNativeEvents(supabase, new Date()));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col gap-6 p-4">
      <h1 className="text-2xl font-semibold">Events</h1>
      <p className="text-base">Events added here and on the wall live only in Nidus. They are not in Google Calendar.</p>
      <button type="button" className={`${action} bg-primary text-primary-foreground`} onClick={() => setSheet({})}>
        Add event
      </button>
      {failed && (
        <p role="alert" className="text-base">
          Could not load events. Check your connection.
        </p>
      )}
      {events?.length === 0 && <p className="text-base">Nothing coming up.</p>}
      <ul className="flex flex-col gap-3">
        {events?.map((event) => (
          <li key={event.id}>
            <button
              type="button"
              onClick={() => setSheet({ occurrence: event })}
              className="flex min-h-12 w-full flex-col gap-1 rounded-lg border border-border p-3 text-left"
              style={{ borderLeftWidth: 8, borderLeftColor: event.color ?? undefined }}
            >
              <span className="flex items-center gap-2 text-lg font-semibold">
                <Pin aria-hidden className="size-4 shrink-0" />
                {event.title}
              </span>
              <span className="text-base">{describeWhen(event, household.timezone)}</span>
            </button>
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
    </main>
  );
}
