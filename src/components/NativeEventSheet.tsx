import { Calendar, CircleAlert, MapPin, Minus, Pin, Plus, Trash2, X } from 'lucide-react';
import { useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import type { Occurrence } from '../lib/calendar-occurrences';
import { dialogKeys } from '../lib/dialog';
import { personStyle } from '../lib/look';
import {
  addedSentence,
  blankEventForm,
  clockWords,
  dayChoices,
  deleteNativeEvent,
  eventFormFromOccurrence,
  eventFormToInput,
  isUntouched,
  moveToDay,
  openingTimes,
  saveNativeEvent,
  stepEnd,
  stepStart,
  type EventForm,
} from '../lib/native-events';
import { ProfileFilterContext } from '../lib/profile-filter';
import { loadProfiles, type Profile } from '../lib/profiles';
import { householdDay } from '../lib/routines';
import { useStatusLine } from '../lib/status-line';
import { supabase } from '../lib/supabase';
import { HouseDisc, PersonDisc } from './people';
import { Button } from './ui/button';

// A field's caption, above it.
const caption = 'text-[15px] leading-5 text-muted-foreground';
// A pill in the "When" row and a chip in "Who is it for?": 52 tall, round, a ring and weight when pressed (look.md, Selected).
const pill = 'h-13 rounded-full font-medium';
// A person's chip keeps their soft colour when pressed, so only its ring answers. It is never wider than its row: a long name
// gives way inside it (the name is a truncating span).
const chip = `${pill} max-w-full gap-2 pr-4 pl-2 selected:ring-[2.5px]`;
const footerButton = 'h-14 text-[17px]';
// The footer's two buttons wrap as one, so on a narrow screen the note has a row (with Delete beside it) and the buttons the next.
// On the Wall they are the drawing's: 190 wide at the least, and the note takes the rest.
const answers = 'flex flex-auto items-center gap-3 min-[960px]:flex-none';
const main = 'min-w-0 flex-1 min-[960px]:min-w-[190px] min-[960px]:flex-none';

// How long a finger holds a stepper before it steps again, and how often it steps after that.
const HOLD_MS = 450;
const REPEAT_MS = 120;

// One of a stepper's two buttons. A press steps once at once; held, it steps again after a pause and then every little while,
// until the finger lifts or leaves the button, or `step` says it has nowhere further to go (`step` moves, and says whether it
// did). The pointer is captured, so the lift is heard wherever the finger has slid to. A click is for the keyboard and a
// screen reader, which send it with no pointer behind it (`detail` 0): a tap has stepped already. A press that cannot move
// the time (a limit) is dimmed, not switched off, so a key or switch user's focus stays where it was, and does nothing.
function StepButton({ name, stuck, step, children }: { name: string; stuck: boolean; step: () => boolean; children: ReactNode }) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const stop = () => clearTimeout(timer.current);
  const again = () => {
    if (step()) timer.current = setTimeout(again, REPEAT_MS);
  };
  // No timer outlives the sheet.
  useEffect(() => {
    const held = timer;
    return () => clearTimeout(held.current);
  }, []);
  return (
    <Button
      aria-label={name}
      aria-disabled={stuck || undefined}
      onPointerDown={(event) => {
        if (stuck || event.button !== 0) return;
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // A pointer that is already gone has nothing to hold.
        }
        stop();
        if (step()) timer.current = setTimeout(again, HOLD_MS);
      }}
      onPointerMove={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) stop();
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onClick={(event) => {
        if (event.detail === 0 && !stuck) step();
      }}
      className="size-12 rounded-[10px] bg-accent p-0 aria-disabled:pointer-events-none aria-disabled:opacity-40"
    >
      {children}
    </Button>
  );
}

// Starts or Ends: its words, the time between a minus and a plus. One press is a quarter hour. The drawing's 105 px between
// the buttons holds "2:00 PM" in Young Serif and no more, and "10:00 AM" is wider, so the AM or PM is set small, as the
// header's clock sets it. The time is a live region that says which time it is ("Starts 9:15 AM") with a real space before the
// AM or PM, so a screen reader hears what changed.
function Stepper({ id, words, noun, time, earlierStuck, laterStuck, onStep }: { id: string; words: string; noun: string; time: string; earlierStuck: boolean; laterStuck: boolean; onStep: (direction: 1 | -1) => boolean }) {
  const [clock, meridiem] = clockWords(time).split(' ');
  return (
    <div role="group" aria-labelledby={id} className="flex min-w-0 flex-col gap-2">
      <span id={id} className={caption}>
        {words}
      </span>
      <div className="flex h-15 items-center rounded-2xl bg-muted px-1.5">
        <StepButton name={`${noun} earlier`} stuck={earlierStuck} step={() => onStep(-1)}>
          <Minus aria-hidden className="size-6" strokeWidth={2.4} />
        </StepButton>
        <output className="flex min-w-0 flex-1 items-baseline justify-center gap-1 whitespace-nowrap">
          <span className="sr-only">{`${words} `}</span>
          <span className="font-display text-2xl">{clock}</span>
          {' '}
          <span className="text-base font-medium">{meridiem}</span>
        </output>
        <StepButton name={`${noun} later`} stuck={laterStuck} step={() => onStep(1)}>
          <Plus aria-hidden className="size-6" strokeWidth={2.4} />
        </StepButton>
      </div>
    </div>
  );
}

// Creates a Native Event, or edits or deletes the one in `occurrence`. One sheet for the Wall and the phone, written by a
// Household Account or a Device, whichever session `supabase` holds. On the Wall it is 940 x 580 over the scrim in two
// columns, with its title row and its footer always in view; below 960 px it is one column that scrolls between them.
// Focus moves in on open and back to what opened it on close. A tap on the scrim closes it only while nothing has been
// typed or changed; Close, Cancel and Escape always do. After a save, an edit or a delete the status line says what
// happened, from whichever screen opened the sheet (the Wall's, and the phone's pages have one too). On the Wall, a
// save or a delete clears the Profile filter, which would otherwise hide the event just written (or the gap where
// it was).
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
  const dateField = useRef<HTMLInputElement>(null);
  const { clear: clearFilter } = useContext(ProfileFilterContext);
  const say = useStatusLine();
  // The form as the sheet opened with it: what "nothing has been typed or changed" is measured against. A new event opens at
  // the next whole hour when it is for today, and at 9:00 AM otherwise.
  const [opened] = useState<EventForm>(() => (occurrence ? eventFormFromOccurrence(occurrence, timezone) : { ...blankEventForm(date), ...openingTimes(date, timezone) }));
  const [form, setForm] = useState<EventForm>(opened);
  // The form as the last change left it, which a step in a held press reads between renders. `change` is the one way to alter it.
  const latest = useRef<EventForm>(opened);
  // Once a stepper has moved the times, they stay when the day changes; so they do, always, for an event being edited.
  const keepTimes = useRef(occurrence !== undefined);
  const days = dayChoices(householdDay(timezone).date);
  // "Another day" is a choice of its own, not what the date happens to be: a date picked in its field that is also today
  // or one of the next two must not take the field away from under the finger.
  const [another, setAnother] = useState(() => !days.some((day) => day.date === opened.date));
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const editing = occurrence !== undefined;
  // Makes a change to the form and says whether it was one. A change that is none (a stepper at its limit) leaves a problem
  // that is showing where it is.
  const change = (next: (form: EventForm) => EventForm): boolean => {
    const before = latest.current;
    const after = next(before);
    if (after === before) return false;
    latest.current = after;
    setProblem('');
    setForm(after);
    return true;
  };
  const set = (changes: Partial<EventForm>) => change((prev) => ({ ...prev, ...changes }));
  const pickDay = (picked: string) => change((prev) => moveToDay(prev, picked, keepTimes.current, timezone));
  const stepTimes = (move: (form: EventForm) => EventForm) => {
    const moved = change(move);
    if (moved) keepTimes.current = true;
    return moved;
  };

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => opener?.focus();
  }, []);

  // A button that had focus may go (Keep it) or be switched off (saving): focus then falls to the page behind, and
  // Escape and Tab would no longer reach the sheet. Put it back on the sheet.
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

  async function run(work: () => Promise<void>, failure: string, said: string) {
    setBusy(true);
    try {
      await work();
      clearFilter();
      say(said);
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
    void run(
      () => saveNativeEvent(supabase, input, occurrence?.id).then(() => undefined),
      'Could not save the event. Check your connection and try again.',
      editing ? `Saved ${input.title}` : addedSentence(input, timezone),
    );
  }

  // Everyone is nobody pressed: pressing a person lets Everyone go, pressing Everyone lets every person go.
  const nobody = form.profileIds.length === 0;
  const pressPerson = (id: string) =>
    change((prev) => ({ ...prev, profileIds: prev.profileIds.includes(id) ? prev.profileIds.filter((other) => other !== id) : [...prev.profileIds, id] }));

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-scrim p-3 min-[960px]:p-4"
      // A press on the scrim must not take the focus off what had it. A sheet that stays open (something was typed) would
      // otherwise have its focus on the page behind it, and Escape, which the sheet hears, would never reach it.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) event.preventDefault();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && isUntouched(form, opened)) onClose();
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
        className="flex max-h-full min-h-0 w-full max-w-[940px] flex-col gap-[18px] rounded-[28px] bg-card p-4 outline-none min-[960px]:min-h-[min(580px,100%)] min-[960px]:p-6"
      >
        <div className="flex h-12 flex-none items-center justify-between">
          <h2 id="native-event-title" className="font-display text-[30px] leading-9">
            {editing ? 'Edit event' : 'New event'}
          </h2>
          <Button variant="quiet" aria-label="Close" onClick={onClose} className="size-12 rounded-full p-0">
            <X aria-hidden className="size-[26px]" strokeWidth={2.2} />
          </Button>
        </div>

        {/* The fields scroll between the title row and the footer when the screen is short; the padding is room for a
            focus ring at the edge, taken back by the margin. */}
        <div className="-m-1 min-h-0 flex-1 overflow-y-auto p-1">
          <div className="grid grid-cols-1 gap-[18px] min-[960px]:grid-cols-2 min-[960px]:gap-x-6">
            <div className="@container flex min-w-0 flex-col justify-between gap-[18px]">
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
                <Stepper
                  id="starts-label"
                  words="Starts"
                  noun="Start"
                  time={form.startTime}
                  earlierStuck={stepStart(form, -1) === form}
                  laterStuck={stepStart(form, 1) === form}
                  onStep={(direction) => stepTimes((prev) => stepStart(prev, direction))}
                />
                <Stepper
                  id="ends-label"
                  words="Ends"
                  noun="End"
                  time={form.endTime}
                  earlierStuck={stepEnd(form, -1) === form}
                  laterStuck={stepEnd(form, 1) === form}
                  onStep={(direction) => stepTimes((prev) => stepEnd(prev, direction))}
                />
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
        </div>

        <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-2">
          {confirming && occurrence ? (
            <>
              <p id="delete-question" className="min-w-48 flex-1 truncate text-[17px] font-medium">
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
                  onClick={() => void run(() => deleteNativeEvent(supabase, occurrence.id), 'Could not delete the event. Check your connection and try again.', `Deleted ${occurrence.title}`)}
                >
                  Delete
                </Button>
              </div>
            </>
          ) : (
            <>
              {/* A quiet button has no edge to line up with the fields, so its icon is what is brought to theirs. */}
              {editing && (
                <Button variant="quiet" disabled={busy} className={`${footerButton} -ml-4 px-5 font-medium`} onClick={() => setConfirming(true)}>
                  <Trash2 aria-hidden />
                  Delete
                </Button>
              )}
              {problem ? (
                // A problem has a row of its own on one column (with Delete above it, when editing), so a sentence as long as the
                // clocks' one is read whole.
                <p role="alert" className="flex min-w-48 grow basis-full items-center gap-2 text-[15px] font-medium min-[960px]:basis-0">
                  <CircleAlert aria-hidden className="size-[18px] shrink-0" />
                  <span className="line-clamp-3 min-w-0 leading-5 min-[960px]:line-clamp-2">{problem}</span>
                </p>
              ) : (
                <p className="flex min-w-48 flex-1 items-center gap-2 text-[15px] text-muted-foreground">
                  <Pin aria-hidden className="size-[18px] shrink-0" />
                  <span className="line-clamp-2 min-w-0 leading-5">{editing ? 'Added here. Not in Google Calendar.' : 'Saved here only. It will not appear in Google Calendar.'}</span>
                </p>
              )}
              <div className={answers}>
                <Button variant="quiet" className={`${footerButton} px-6 font-medium`} onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={busy} className={`${footerButton} ${main}`}>
                  {editing ? 'Save changes' : 'Add event'}
                </Button>
              </div>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
