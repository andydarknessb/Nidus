import { Calendar, CircleAlert, MapPin, Pin, Trash2, X } from 'lucide-react';
import { useContext, useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import type { Occurrence } from '../lib/calendar-occurrences';
import { changeRepeat, chooseAnotherDay, chooseRepeat, dayRow, pickDate, pickDay, pressEveryone, pressPerson, setField, untouched, type Plan } from '../lib/event-draft';
import { personStyle } from '../lib/look';
import { runPlan, timeInputWords } from '../lib/native-events';
import { WEEKDAYS } from '../lib/routines';
import { ProfileFilterContext } from '../lib/profile-filter';
import type { Profile } from '../lib/profiles';
import { useStatusLine } from '../lib/status-line';
import { supabase } from '../lib/supabase';
import { useChange } from '../lib/change';
import { useEventDraft } from '../lib/use-event-draft';
import { HouseDisc, PersonDisc } from './people';
import { Sheet } from './Sheet';
import { TimeSheet } from './TimeSheet';
import { Button } from './ui/button';
import { householdDay } from '@shared/zoned-time.ts';

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
// The Repeats row's pills, and the plural a Repeat's number is counted in.
const EVERY = [
  { every: 'day', label: 'Every day', plural: 'days' },
  { every: 'week', label: 'Every week', plural: 'weeks' },
  { every: 'month', label: 'Every month', plural: 'months' },
  { every: 'year', label: 'Every year', plural: 'years' },
] as const;
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

// The footer's question. An event with no Repeat asks "Delete <title>?" and its answers are Keep it and Delete. An Occurrence of a
// Repeat asks which of its events is meant, at Save ("Change this one, or every one?") and at Delete ("Delete this one, or every
// one?"), and answers "This one" or "Every one"; Back takes the question away. Focus lands on the safe answer, so a screen reader
// hears the question with it.
export function EventQuestion({
  asking,
  title,
  repeating,
  busy,
  onBack,
  onOne,
  onEvery,
}: {
  asking: 'delete' | 'save';
  title: string;
  repeating: boolean;
  busy: boolean;
  // Keep it, or Back.
  onBack: () => void;
  // "This one"; unused when there is no Repeat.
  onOne: () => void;
  // "Every one", or Delete when there is no Repeat.
  onEvery: () => void;
}) {
  return (
    <>
      {/* A title may be long and gives way. The question about a Repeat is read whole: as wide as its words, on a row of its own when
          the answers leave it less (a tablet upright). */}
      <p id="ask-question" className={`${repeating ? 'min-w-0 flex-auto' : 'min-w-[min(12rem,100%)] flex-1 truncate'} text-[17px] font-medium`}>
        {!repeating ? `Delete ${title}?` : asking === 'save' ? 'Change this one, or every one?' : 'Delete this one, or every one?'}
      </p>
      <div className={answers}>
        {repeating ? (
          <>
            <Button variant="quiet" disabled={busy} className={`${footerButton} font-medium`} onClick={onBack}>
              Back
            </Button>
            <Button variant="secondary" autoFocus aria-describedby="ask-question" disabled={busy} className={`${footerButton} font-medium`} onClick={onOne}>
              This one
            </Button>
            <Button variant={asking === 'save' ? 'primary' : 'delete'} disabled={busy} className={`${footerButton} ${main}`} onClick={onEvery}>
              Every one
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" autoFocus aria-describedby="ask-question" className={`${footerButton} px-6 font-medium`} onClick={onBack}>
              Keep it
            </Button>
            <Button variant="delete" aria-label={`Delete ${title}`} disabled={busy} className={`${footerButton} ${main}`} onClick={onEvery}>
              Delete
            </Button>
          </>
        )}
      </div>
    </>
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
  const untilField = useRef<HTMLInputElement>(null);
  const { clear: clearFilter } = useContext(ProfileFilterContext);
  const say = useStatusLine();
  const card = useChange();
  // The form's rules are the event draft's (lib/event-draft.ts); this sheet draws it and runs the plan it comes to.
  const events = useEventDraft(occurrence ? { occurrence } : { date }, timezone);
  const { form, asking } = events.draft;
  // Which time the time sheet is open for, if one is.
  const [picking, setPicking] = useState<'start' | 'end' | null>(null);
  const { days, another } = dayRow(events.draft, householdDay(timezone).date);
  const { busy } = card;
  const problem = card.problem(PLACE);
  const editing = occurrence !== undefined;
  const repeating = occurrence?.repeat_every != null;
  const { repeat } = form;
  const title = editing ? 'Edit event' : 'New event';
  // A move of the draft that was one takes away a problem that is showing; one that is none leaves it where it is.
  const move = (transition: Parameters<typeof events.move>[0]) => {
    if (events.move(transition)) card.clear(PLACE);
  };
  // The time sheet's Done: Starts takes Ends with it, and an Ends that is not after Starts is refused, in words the time sheet says.
  const setTime = (which: 'start' | 'end', time: string): string | undefined => {
    const refused = events.setTime(which, time);
    if (refused === undefined) card.clear(PLACE);
    return refused;
  };

  // Runs a plan through the one change, which words a write that did not go through (the Wall's one vocabulary, which says "No
  // internet" when that is the trouble). runPlan gives what the status line says once it landed; then the filter is cleared and the
  // screen behind reads again (onSaved). A write that failed takes the question away, so the footer can say why.
  const write = (plan: Plan) =>
    card.change(PLACE, () => runPlan(supabase, plan, timezone), {
      landed: (said) => {
        clearFilter();
        say(said);
        onSaved();
      },
      failed: () => {
        events.failed();
      },
    });

  function submit(event: FormEvent) {
    event.preventDefault();
    const result = events.submit();
    if (result && 'problem' in result) card.say(PLACE, result.problem);
    else if (result) void write(result.plan);
  }

  // "This one" and "Every one" at Save and at Delete, for an Occurrence of a Repeat.
  const answer = (which: 'one' | 'every') => {
    const plan = events.answer(which);
    if (plan) void write(plan);
  };

  const nobody = form.profileIds.length === 0;

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
      {asking && occurrence ? (
        <EventQuestion
          asking={asking}
          title={occurrence.title}
          repeating={repeating}
          busy={busy}
          onBack={() => void events.back()}
          onOne={() => answer('one')}
          onEvery={() => answer('every')}
        />
      ) : (
        <>
          {/* A quiet button has no edge to line up with the fields, so its icon is what is brought to theirs. */}
          {editing && (
            <Button variant="quiet" disabled={busy} className={`${footerButton} -ml-4 px-[20px] font-medium`} onClick={() => void events.askToDelete()}>
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
        canDismiss={() => untouched(events.draft)}
        onSubmit={submit}
        refocusOn={`${asking} ${busy}`}
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
              <input className="h-15 px-4 text-[19px]" value={form.title} onChange={(e) => move((d) => setField(d, { title: e.target.value }))} maxLength={200} required />
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
                      move((d) => pickDay(d, day.date));
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
                    flushSync(() => events.move(chooseAnotherDay));
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
              {another && <input ref={dateField} type="date" aria-label="Date" className="h-13 w-full text-[17px]" value={form.date} onChange={(e) => move((d) => pickDate(d, e.target.value))} required />}
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
                onClick={() => move((d) => setField(d, { allDay: !d.form.allDay }))}
                className="group relative -mr-2 box-content h-8 w-14 shrink-0 rounded-full border-8 border-transparent bg-accent bg-clip-padding shadow-[inset_0_0_0_1.5px_var(--input)] focus-visible:-outline-offset-6 aria-checked:bg-primary"
              >
                <span className="absolute top-1 left-1 size-6 rounded-full bg-muted-foreground transition-transform group-aria-checked:translate-x-6 group-aria-checked:bg-primary-foreground" />
              </button>
            </label>

            <div role="group" aria-labelledby="repeats-label" className="flex flex-col gap-2">
              <span id="repeats-label" className={caption}>
                Repeats
              </span>
              <div className="flex flex-wrap gap-2">
                <Button aria-pressed={repeat === null} onClick={() => move((d) => chooseRepeat(d, null))} className={`${pill} flex-auto px-3`}>
                  Doesn't repeat
                </Button>
                {EVERY.map((choice) => (
                  <Button key={choice.every} aria-pressed={repeat?.every === choice.every} onClick={() => move((d) => chooseRepeat(d, choice.every))} className={`${pill} flex-auto px-3`}>
                    {choice.label}
                  </Button>
                ))}
              </div>
              {repeat && (
                <>
                  <div className="flex items-center gap-3 text-[17px]">
                    Every
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={99}
                      aria-label="Every how many"
                      className="h-15 w-20 px-2 text-center text-[19px]"
                      value={repeat.interval || ''}
                      onChange={(e) => move((d) => changeRepeat(d, { interval: Number(e.target.value) }))}
                    />
                    {EVERY.find((choice) => choice.every === repeat.every)?.plural}
                  </div>
                  {repeat.every === 'week' && (
                    <div role="group" aria-label="Repeat on" className="flex flex-wrap gap-2">
                      {WEEKDAYS.map((day) => (
                        <Button
                          key={day.bit}
                          aria-pressed={(repeat.days & (1 << day.bit)) !== 0}
                          aria-label={day.name}
                          onClick={() => move((d) => changeRepeat(d, { days: repeat.days ^ (1 << day.bit) }))}
                          className={`${pill} min-w-13 flex-auto px-2`}
                        >
                          {day.short}
                        </Button>
                      ))}
                    </div>
                  )}
                  <div role="group" aria-labelledby="repeat-ends-label" className="flex flex-col gap-2">
                    <span id="repeat-ends-label" className={caption}>
                      Ends
                    </span>
                    <div className="flex flex-wrap gap-2">
                      <Button aria-pressed={repeat.until === null} onClick={() => move((d) => changeRepeat(d, { until: null }))} className={`${pill} flex-auto px-3`}>
                        Never
                      </Button>
                      <Button
                        aria-pressed={repeat.until !== null}
                        onClick={() => {
                          // As "Another day" does: the field is on the page at once and asks for its picker in this same tap.
                          flushSync(() => move((d) => changeRepeat(d, { until: repeat.until ?? form.date })));
                          try {
                            untilField.current?.showPicker();
                          } catch {
                            untilField.current?.focus();
                          }
                        }}
                        className={`${pill} flex-auto px-3`}
                      >
                        <Calendar aria-hidden />
                        On a date
                      </Button>
                    </div>
                    {repeat.until !== null && (
                      <input ref={untilField} type="date" aria-label="Repeat until" className="h-13 w-full text-[17px]" value={repeat.until} onChange={(e) => move((d) => changeRepeat(d, { until: e.target.value }))} required />
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-[18px]">
            <div role="group" aria-labelledby="who-label" className="flex flex-col gap-2">
              <span id="who-label" className={caption}>
                Who is it for?
              </span>
              <div className="flex flex-wrap gap-2">
                <Button aria-pressed={nobody} onClick={() => move(pressEveryone)} className={`${chip} selected:bg-secondary`}>
                  <HouseDisc size={34} />
                  Everyone
                </Button>
                {profiles.map((profile) => (
                  <Button
                    key={profile.id}
                    variant="quiet"
                    aria-pressed={form.profileIds.includes(profile.id)}
                    onClick={() => move((d) => pressPerson(d, profile.id))}
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
                <input className="h-14 w-full pr-4 pl-12 text-[17px]" value={form.location} onChange={(e) => move((d) => setField(d, { location: e.target.value }))} maxLength={500} placeholder="Add a place" />
                <MapPin aria-hidden className="pointer-events-none absolute top-[18px] left-4 size-5 text-muted-foreground" />
              </span>
            </label>

            {/* The box takes what height is left, so a tall left column (the date field is showing) does not leave a gap under it. */}
            <label className="flex flex-1 flex-col gap-2">
              <span className={caption}>Notes (optional)</span>
              <textarea className="min-h-24 w-full flex-1 resize-none px-4 py-3 text-[17px]" value={form.notes} onChange={(e) => move((d) => setField(d, { notes: e.target.value }))} maxLength={5000} />
            </label>
          </div>
        </div>
      </Sheet>
      {picking && <TimeSheet which={picking} time={picking === 'start' ? form.startTime : form.endTime} onDone={(time) => setTime(picking, time)} onClose={() => setPicking(null)} />}
    </>
  );
}
