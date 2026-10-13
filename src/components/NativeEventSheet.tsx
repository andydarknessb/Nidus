import { Calendar, CircleAlert, MapPin, Pin, Trash2, X } from 'lucide-react';
import { useContext, useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import type { Occurrence } from '../lib/calendar-occurrences';
import { personStyle } from '../lib/look';
import {
  addedSentence,
  blankEventForm,
  timeInputWords,
  dayChoices,
  deleteNativeEvent,
  eventFormFromOccurrence,
  eventFormToInput,
  isUntouched,
  moveToDay,
  openingTimes,
  saveNativeEvent,
  savedSentence,
  type EventForm,
} from '../lib/native-events';
import { ProfileFilterContext } from '../lib/profile-filter';
import type { Profile } from '../lib/profiles';
import { useStatusLine } from '../lib/status-line';
import { supabase } from '../lib/supabase';
import { useChange } from '../lib/synced-read';
import { setEnd, setStart } from '../lib/time-picker';
import { HouseDisc, PersonDisc } from './people';
import { Sheet } from './Sheet';
import { TimeSheet } from './TimeSheet';
import { Button } from './ui/button';
import { householdDay } from '../../supabase/functions/_shared/zoned-time.ts';

// A field's caption, above it.
const caption = 'text-[15px] leading-5 text-muted-foreground';
// A pill in the "When" row and a chip in "Who is it for?": 52 tall, round, a ring and weight when pressed (look.md, Selected).
const pill = 'h-13 rounded-full font-medium';
// A person's chip keeps their soft colour when pressed, so only its ring answers. It is never wider than its row: a long name
// gives way inside it (the name is a truncating span).
const chip = `${pill} max-w-full gap-2 pr-4 pl-2 selected:ring-[2.5px]`;
const footerButton = 'h-14 px-[24px] text-[17px]';
// The footer's two buttons wrap as one, so on a narrow screen the note has a row (with Delete beside it) and the buttons the next.
// On the Wall they are the drawing's: 190 wide at the least, and the note takes the rest.
const answers = 'flex max-w-full min-w-0 flex-auto items-center gap-3 min-[960px]:flex-none';
const main = 'min-w-0 flex-1 min-[960px]:min-w-[190px] min-[960px]:flex-none';
// Where the form's words about a write (or a field) are said: the one place of its footer.
const PLACE = 'event';

// Starts or Ends: its words over a button that shows the time and opens the time sheet for it. The AM or PM is set small, as the
// header's clock sets it. The button's name says which time it is and what it is ("Starts, 2:00 PM"), so the caption over it is
// not read twice.
function TimeField({ words, time, onOpen }: { words: string; time: string; onOpen: () => void }) {
  const said = timeInputWords(time);
  const [clock, meridiem] = said.split(' ');
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span aria-hidden="true" className={caption}>
        {words}
      </span>
      <button type="button" aria-label={`${words}, ${said}`} onClick={onOpen} className="flex h-15 w-full items-center justify-center rounded-2xl bg-muted px-4 whitespace-nowrap active:bg-accent">
        <span className="flex items-baseline gap-1">
          <span className="font-display text-2xl">{clock}</span>
          <span className="text-base font-medium">{meridiem}</span>
        </span>
      </button>
    </div>
  );
}

// Creates a Native Event, or edits or deletes the one in `occurrence`. One sheet for the Wall and the phone, written by a
// Household Account or a Device, whichever session `supabase` holds. On the Wall it is 940 x 580 over the scrim in two
// columns, with its title row and its footer always in view; below 960 px it is one column that scrolls between them. What
// scrolls between them is a SheetBody: with many people the Wall's two columns are taller than the screen, and it says so.
// Its frame is the Sheet's: focus moves in on open and back to what opened it on close, and the page behind it is inert. A tap on the
// scrim closes it only while nothing has been typed or changed (its `canDismiss`); Close, Cancel and Escape always do. After a save,
// an edit or a delete the status line says what happened, from whichever screen opened the sheet (the Wall's, and the phone's pages
// have one too). On the Wall, a save or a delete clears the Profile filter, which would otherwise hide the event just written (or the
// gap where it was). What a write that did not go through says is the change's (useChange), said in the footer and taken away by the
// next edit.
export function NativeEventSheet({
  timezone,
  profiles,
  date,
  occurrence,
  onSaved,
  onClose,
}: {
  timezone: string;
  // The Household's Profiles, from whichever screen opened the sheet: "Who is it for?" offers them. None yet is only Everyone.
  profiles: readonly Profile[];
  // After a save or a delete, so the screen behind can read again.
  onSaved: () => void;
  onClose: () => void;
} & (
  // Either the Household date a new event starts on, or the event being edited, which starts from itself.
  | { date: string; occurrence?: undefined }
  | { date?: undefined; occurrence: Occurrence }
)) {
  const dateField = useRef<HTMLInputElement>(null);
  const { clear: clearFilter } = useContext(ProfileFilterContext);
  const say = useStatusLine();
  const card = useChange();
  // The form as the sheet opened with it: what "nothing has been typed or changed" is measured against. A new event opens at
  // the next whole hour when it is for today, and at 9:00 AM otherwise.
  const [opened] = useState<EventForm>(() => (occurrence ? eventFormFromOccurrence(occurrence, timezone) : { ...blankEventForm(date), ...openingTimes(date, timezone) }));
  const [form, setForm] = useState<EventForm>(opened);
  // The form as the last change left it, which the time sheet's Done reads. `change` is the one way to alter it.
  const latest = useRef<EventForm>(opened);
  // Once a time has been set, the times stay when the day changes; so they do, always, for an event being edited.
  const keepTimes = useRef(occurrence !== undefined);
  // Which time the time sheet is open for, if one is.
  const [picking, setPicking] = useState<'start' | 'end' | null>(null);
  const days = dayChoices(householdDay(timezone).date);
  // "Another day" is a choice of its own, not what the date happens to be: a date picked in its field that is also today
  // or one of the next two must not take the field away from under the finger.
  const [another, setAnother] = useState(() => !days.some((day) => day.date === opened.date));
  const [confirming, setConfirming] = useState(false);
  const { busy } = card;
  const problem = card.problem(PLACE);
  const editing = occurrence !== undefined;
  const title = editing ? 'Edit event' : 'New event';
  // Makes a change to the form and says whether it was one. A change that is none leaves a problem that is showing where it is;
  // one that is one takes it away.
  const change = (next: (form: EventForm) => EventForm): boolean => {
    const before = latest.current;
    const after = next(before);
    if (after === before) return false;
    latest.current = after;
    card.clear(PLACE);
    setForm(after);
    return true;
  };
  const set = (changes: Partial<EventForm>) => change((prev) => ({ ...prev, ...changes }));
  const pickDay = (picked: string) => change((prev) => moveToDay(prev, picked, keepTimes.current, timezone));
  // The time sheet's Done: Starts takes Ends with it, and an Ends that is not after Starts is refused, in words the time sheet says.
  const setTime = (which: 'start' | 'end', time: string): string | undefined => {
    const next = which === 'start' ? setStart(latest.current, time) : setEnd(latest.current, time);
    if ('problem' in next) return next.problem;
    change(() => next);
    keepTimes.current = true;
    return undefined;
  };

  // Saves or deletes through the one change, which words a write that did not go through (the Wall's one vocabulary, which says "No
  // internet" when that is the trouble). Once it landed the filter is cleared, the status line says what happened, and the screen
  // behind reads again (onSaved).
  const write = (work: () => Promise<void>, said: string) =>
    card.change(PLACE, work, {
      landed: () => {
        clearFilter();
        say(said);
        onSaved();
      },
    });

  function submit(event: FormEvent) {
    event.preventDefault();
    const input = eventFormToInput(form, timezone);
    if ('problem' in input) {
      card.say(PLACE, input.problem);
      return;
    }
    void write(() => saveNativeEvent(supabase, input, occurrence?.id).then(() => undefined), editing ? savedSentence(input, timezone) : addedSentence(input, timezone));
  }

  // Everyone is nobody pressed: pressing a person lets Everyone go, pressing Everyone lets every person go.
  const nobody = form.profileIds.length === 0;
  const pressPerson = (id: string) =>
    change((prev) => ({ ...prev, profileIds: prev.profileIds.includes(id) ? prev.profileIds.filter((other) => other !== id) : [...prev.profileIds, id] }));

  const header = (
    <div className="flex h-12 flex-none items-center justify-between">
      <h2 id="native-event-title" className="font-display text-[30px] leading-9">
        {title}
      </h2>
      <Button variant="quiet" aria-label="Close" onClick={onClose} className="size-12 rounded-full p-0">
        <X aria-hidden className="size-[26px]" strokeWidth={2.2} />
      </Button>
    </div>
  );

  const footer = (
    <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-2">
      {confirming && occurrence ? (
        <>
          <p id="delete-question" className="min-w-[min(12rem,100%)] flex-1 truncate text-[17px] font-medium">
            Delete {occurrence.title}?
          </p>
          <div className={answers}>
            {/* Focus lands on the safe answer, so a screen reader hears the question with it. */}
            <Button variant="secondary" autoFocus aria-describedby="delete-question" className={`${footerButton} px-6 font-medium`} onClick={() => setConfirming(false)}>
              Keep it
            </Button>
            <Button
              variant="delete"
              aria-label={`Delete ${occurrence.title}`}
              disabled={busy}
              className={`${footerButton} ${main}`}
              onClick={() => void write(() => deleteNativeEvent(supabase, occurrence.id), `Deleted ${occurrence.title}`)}
            >
              Delete
            </Button>
          </div>
        </>
      ) : (
        <>
          {/* A quiet button has no edge to line up with the fields, so its icon is what is brought to theirs. */}
          {editing && (
            <Button variant="quiet" disabled={busy} className={`${footerButton} -ml-4 px-[20px] font-medium`} onClick={() => setConfirming(true)}>
              <Trash2 aria-hidden />
              Delete
            </Button>
          )}
          {problem ? (
            // A problem has a row of its own on one column (with Delete above it, when editing), so a sentence as long as the
            // clocks' one is read whole. `n` counts what has been said, so a failure that is the same again is a new alert, heard again.
            <p key={problem.n} role="alert" className="flex min-w-[min(12rem,100%)] grow basis-full items-center gap-2 text-[15px] font-medium min-[960px]:basis-0">
              <CircleAlert aria-hidden className="size-[18px] shrink-0" />
              <span className="line-clamp-3 min-w-0 leading-5 min-[960px]:line-clamp-2">{problem.words}</span>
            </p>
          ) : (
            <p className="flex min-w-[min(12rem,100%)] flex-1 items-center gap-2 text-[15px] text-muted-foreground">
              <Pin aria-hidden className="size-[18px] shrink-0" />
              <span className="line-clamp-2 min-w-0 leading-5">{editing ? 'Added here. Not in Google Calendar.' : 'Saved here only. It will not appear in Google Calendar.'}</span>
            </p>
          )}
          <div className={answers}>
            <Button variant="quiet" className={`${footerButton} font-medium`} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy} className={`${footerButton} ${main}`}>
              {editing ? 'Save changes' : 'Add event'}
            </Button>
          </div>
        </>
      )}
    </div>
  );

  // The time sheet is drawn beside the form's sheet and not inside it: a React event goes up a portal to the component that drew
  // it, so inside, its Escape would close this sheet too.
  return (
    <>
      <Sheet
        labelledBy="native-event-title"
        title={title}
        onClose={onClose}
        // A stray tap on the scrim never throws away what was typed.
        canDismiss={() => isUntouched(form, opened)}
        onSubmit={submit}
        refocusOn={`${confirming} ${busy}`}
        scrim="p-3 min-[960px]:p-4"
        className="max-w-[940px] gap-[18px] p-4 min-[960px]:min-h-[min(580px,100%)] min-[960px]:p-6"
        header={header}
        footer={footer}
      >
        {/* The fields scroll between the title row and the footer when the screen is short, or the family is large; on the Wall
            the foot of the box says so. */}
        <div className="grid grid-cols-1 gap-[18px] min-[960px]:grid-cols-2 min-[960px]:gap-x-6">
          <div className="@container flex min-w-0 flex-col justify-start gap-[18px]">
            <label className="flex flex-col gap-2">
              <span className={caption}>What is it?</span>
              <input className="h-15 px-4 text-[19px]" value={form.title} onChange={(e) => set({ title: e.target.value })} maxLength={200} required />
            </label>

            <div role="group" aria-labelledby="when-label" className="flex flex-col gap-2">
              <span id="when-label" className={caption}>
                When
              </span>
              <div className="flex flex-wrap gap-2">
                {days.map((day) => (
                  <Button
                    key={day.date}
                    aria-pressed={!another && form.date === day.date}
                    onClick={() => {
                      setAnother(false);
                      pickDay(day.date);
                    }}
                    className={`${pill} flex-auto px-3`}
                  >
                    {day.label}
                  </Button>
                ))}
                <Button
                  aria-pressed={another}
                  onClick={() => {
                    // The field is on the page at once and asked for its picker in this same tap, which is the only moment a
                    // browser lets it open. Where it cannot (it throws, or there is no showPicker), the field takes the focus.
                    flushSync(() => setAnother(true));
                    try {
                      dateField.current?.showPicker();
                    } catch {
                      dateField.current?.focus();
                    }
                  }}
                  className={`${pill} flex-auto px-3`}
                >
                  <Calendar aria-hidden />
                  Another day
                </Button>
              </div>
              {another && <input ref={dateField} type="date" aria-label="Date" className="h-13 w-full text-[17px]" value={form.date} onChange={(e) => pickDay(e.target.value)} required />}
            </div>

            {/* All day hides both. On the Wall they keep their room, so When and the switch stay where they were; on one
                column there is nothing to keep, and they go. */}
            <div className={`grid-cols-1 gap-2 @min-[26rem]:grid-cols-2 ${form.allDay ? 'hidden min-[960px]:invisible min-[960px]:grid' : 'grid'}`}>
              <TimeField words="Starts" time={form.startTime} onOpen={() => setPicking('start')} />
              <TimeField words="Ends" time={form.endTime} onOpen={() => setPicking('end')} />
            </div>

            {/* The whole row is the label, so a tap on its words flips the switch too. */}
            <label className="flex h-14 items-center justify-between rounded-2xl bg-muted px-4 text-[17px]">
              All day
              {/* A 56 x 32 track inside a 72 x 48 target: the transparent border is the room a finger needs. */}
              <button
                type="button"
                role="switch"
                aria-checked={form.allDay}
                onClick={() => change((prev) => ({ ...prev, allDay: !prev.allDay }))}
                className="group relative -mr-2 box-content h-8 w-14 shrink-0 rounded-full border-8 border-transparent bg-accent bg-clip-padding shadow-[inset_0_0_0_1.5px_var(--input)] focus-visible:-outline-offset-6 aria-checked:bg-primary"
              >
                <span className="absolute top-1 left-1 size-6 rounded-full bg-muted-foreground transition-transform group-aria-checked:translate-x-6 group-aria-checked:bg-primary-foreground" />
              </button>
            </label>
          </div>

          <div className="flex min-w-0 flex-col gap-[18px]">
            <div role="group" aria-labelledby="who-label" className="flex flex-col gap-2">
              <span id="who-label" className={caption}>
                Who is it for?
              </span>
              <div className="flex flex-wrap gap-2">
                <Button aria-pressed={nobody} onClick={() => set({ profileIds: [] })} className={`${chip} selected:bg-secondary`}>
                  <HouseDisc size={34} />
                  Everyone
                </Button>
                {profiles.map((profile) => (
                  <Button
                    key={profile.id}
                    variant="quiet"
                    aria-pressed={form.profileIds.includes(profile.id)}
                    onClick={() => pressPerson(profile.id)}
                    style={personStyle(profile.color)}
                    className={`person ${chip} bg-person-soft text-foreground selected:bg-person-soft`}
                  >
                    <PersonDisc name={profile.name} color={profile.color} size={34} />
                    <span className="truncate">{profile.name}</span>
                  </Button>
                ))}
              </div>
            </div>

            <label className="flex flex-col gap-2">
              <span className={caption}>Where (optional)</span>
              <span className="relative block h-14">
                <input className="h-14 w-full pr-4 pl-12 text-[17px]" value={form.location} onChange={(e) => set({ location: e.target.value })} maxLength={500} placeholder="Add a place" />
                <MapPin aria-hidden className="pointer-events-none absolute top-[18px] left-4 size-5 text-muted-foreground" />
              </span>
            </label>

            {/* The box takes what height is left, so a tall left column (the date field is showing) does not leave a gap under it. */}
            <label className="flex flex-1 flex-col gap-2">
              <span className={caption}>Notes (optional)</span>
              <textarea className="min-h-24 w-full flex-1 resize-none px-4 py-3 text-[17px]" value={form.notes} onChange={(e) => set({ notes: e.target.value })} maxLength={5000} />
            </label>
          </div>
        </div>
      </Sheet>
      {picking && <TimeSheet which={picking} time={picking === 'start' ? form.startTime : form.endTime} onDone={(time) => setTime(picking, time)} onClose={() => setPicking(null)} />}
    </>
  );
}
