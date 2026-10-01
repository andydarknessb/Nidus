import { useContext, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Occurrence } from '../lib/calendar-occurrences';
import { dialogKeys } from '../lib/dialog';
import {
  blankEventForm,
  deleteNativeEvent,
  eventFormFromOccurrence,
  eventFormToInput,
  saveNativeEvent,
  type EventForm,
} from '../lib/native-events';
import { ProfileFilterContext } from '../lib/profile-filter';
import { loadProfiles, type Profile } from '../lib/profiles';
import { supabase } from '../lib/supabase';

const field = 'min-h-12 w-full rounded-lg border border-input bg-background px-3 text-lg text-foreground';
const action = 'min-h-12 rounded-lg px-6 text-lg font-medium';
const quiet = `${action} border border-border`;
const choice =
  'flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border-2 border-border px-4 text-lg font-medium has-[:checked]:border-foreground has-[:checked]:bg-muted has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-foreground';

// Creates a Native Event, or edits or deletes the one in `occurrence`. One sheet for the tablet
// and the phone: 48 px targets throughout, and it scrolls when the screen is short. Written by a
// Household Account or a Device, whichever session `supabase` holds. Focus moves in on open and
// back to what opened it on close. On the Wall, a save or a delete clears the Profile filter, which
// would otherwise hide the event just written (or the gap where it was).
export function NativeEventSheet({
  timezone,
  date,
  occurrence,
  onSaved,
  onClose,
}: {
  timezone: string;
  // The Household date a new event starts on.
  date: string;
  // Present when editing.
  occurrence?: Occurrence;
  // After a save or a delete, so the screen behind can read again.
  onSaved: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLFormElement>(null);
  const { clear: clearFilter } = useContext(ProfileFilterContext);
  const [form, setForm] = useState<EventForm>(() => (occurrence ? eventFormFromOccurrence(occurrence, timezone) : blankEventForm(date)));
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const editing = occurrence !== undefined;
  const set = (change: Partial<EventForm>) => setForm((prev) => ({ ...prev, ...change }));

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => opener?.focus();
  }, []);

  // A button that had focus may go (Keep it) or be disabled (saving): focus then falls to the page
  // behind, and Escape and Tab would no longer reach the sheet. Put it back on the sheet.
  useEffect(() => {
    if (!dialog.current?.contains(document.activeElement)) dialog.current?.focus();
  }, [confirming, busy]);

  useEffect(() => {
    let live = true;
    loadProfiles(supabase)
      .then((found) => live && setProfiles(found))
      // The event can still be saved for the whole Household.
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  async function run(work: () => Promise<void>, failure: string) {
    setBusy(true);
    try {
      await work();
      clearFilter();
      onSaved();
    } catch {
      setProblem(failure);
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const input = eventFormToInput(form, timezone);
    if ('problem' in input) {
      setProblem(input.problem);
      return;
    }
    setProblem('');
    void run(() => saveNativeEvent(supabase, input, occurrence?.id).then(() => undefined), 'Could not save the event. Check your connection and try again.');
  }

  return (
    <div
      className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-background/90 p-4 sm:items-center sm:p-8"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="native-event-title"
        tabIndex={-1}
        noValidate
        onSubmit={submit}
        onKeyDown={(event) => dialogKeys(event, onClose)}
        className="flex w-full max-w-xl flex-col gap-5 rounded-xl border-2 border-border bg-card p-6 outline-none"
      >
        <h2 id="native-event-title" className="text-3xl font-semibold">
          {editing ? 'Edit event' : 'New event'}
        </h2>
        <label className="flex flex-col gap-2 text-lg">
          Title
          <input className={field} value={form.title} onChange={(e) => set({ title: e.target.value })} maxLength={200} placeholder="Plumber" required />
        </label>
        <label className="flex flex-col gap-2 text-lg">
          Date
          <input className={field} type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} required />
        </label>
        <label className={choice}>
          <input type="checkbox" className="size-6" checked={form.allDay} onChange={(e) => set({ allDay: e.target.checked })} />
          All day
        </label>
        {!form.allDay && (
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-2 text-lg">
              Starts
              <input className={field} type="time" value={form.startTime} onChange={(e) => set({ startTime: e.target.value })} required />
            </label>
            <label className="flex flex-col gap-2 text-lg">
              Ends
              <input className={field} type="time" value={form.endTime} onChange={(e) => set({ endTime: e.target.value })} required />
            </label>
          </div>
        )}
        <label className="flex flex-col gap-2 text-lg">
          Where (optional)
          <input className={field} value={form.location} onChange={(e) => set({ location: e.target.value })} maxLength={500} />
        </label>
        <label className="flex flex-col gap-2 text-lg">
          Notes (optional)
          <textarea className={`${field} min-h-24 py-2`} value={form.notes} onChange={(e) => set({ notes: e.target.value })} maxLength={5000} rows={3} />
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-lg">Who is it for?</legend>
          <div className="flex flex-wrap gap-2">
            {profiles.map((profile) => (
              <label key={profile.id} className={choice}>
                <input
                  type="checkbox"
                  className="size-6"
                  checked={form.profileIds.includes(profile.id)}
                  onChange={(e) =>
                    set({ profileIds: e.target.checked ? [...form.profileIds, profile.id] : form.profileIds.filter((id) => id !== profile.id) })
                  }
                />
                <span aria-hidden className="size-4 shrink-0 rounded-full" style={{ backgroundColor: profile.color }} />
                {profile.name}
              </label>
            ))}
          </div>
          <p className="text-base">{form.profileIds.length === 0 ? 'No one picked: it is for the whole household.' : ''}</p>
        </fieldset>
        <p role="alert" className="min-h-6 text-lg empty:hidden">
          {problem}
        </p>
        <div className="flex flex-wrap gap-3">
          <button type="submit" className={`${action} bg-primary text-primary-foreground disabled:opacity-40`} disabled={busy}>
            {editing ? 'Save changes' : 'Add event'}
          </button>
          <button type="button" className={quiet} onClick={onClose}>
            Cancel
          </button>
          {editing && !confirming && (
            <button type="button" className={`${quiet} ml-auto`} disabled={busy} onClick={() => setConfirming(true)}>
              Delete
            </button>
          )}
        </div>
        {editing && confirming && (
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              autoFocus
              className={`${action} border-2 border-destructive bg-primary text-primary-foreground disabled:opacity-40`}
              disabled={busy}
              onClick={() => void run(() => deleteNativeEvent(supabase, occurrence.id), 'Could not delete the event. Check your connection and try again.')}
            >
              Delete {occurrence.title}
            </button>
            <button type="button" className={quiet} onClick={() => setConfirming(false)}>
              Keep it
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
