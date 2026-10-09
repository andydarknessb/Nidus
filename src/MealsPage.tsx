import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { InBody } from './components/InBody';
import { ReadState } from './components/ReadState';
import { PHONE_FRAME, PHONE_SCRIM, SheetHandle } from './components/Sheet';
import { Button } from './components/ui/button';
import { describePage } from './lib/calendar-occurrences';
import type { WallDay } from './lib/paged-view';
import { dialogKeys } from './lib/dialog';
import { appBehind, holdBackground } from './lib/inert-behind';
import { dayName, NOTHING_PLANNED, type MealSheetCell } from './lib/meal-plan';
import { MEAL_SLOTS, nextMealWords, type MealSlot } from './lib/meals';
import { WEEKDAYS } from './lib/routines';
import { useFailureWords } from './lib/use-failure-words';
import { SLOT_PICTURES, useMealPlan, useNextMeal } from './lib/use-meal-plan';

// Meals on the wall (CONTEXT.md: Meal): the Meals screen, a week by slot, and the header's button for the
// next meal of today. Written by a Household Account or a Device, whichever session `supabase` holds.

// ---- The Meals screen: a week by slot ------------------------------------------------

// The week the screen is on: `date` is the page's anchor (null for this week, which the screen then
// follows as the weeks turn), pulled into the window the calendar pages within and snapped to its
// Sunday, as the week view does. `onNavigate` opens a week by its Sunday, or by null when it holds
// today (Today, and paging back onto it), which a Wall left there then follows as the weeks turn.
// `portrait` is the Wall's one read of the window (useHomeLayout, from the shell): a tablet hung upright turns the plan (docs/specs/0009).
export function MealsScreen({ timezone, date, onNavigate, portrait = false }: { timezone: string; date: string | null; onNavigate: (date: string | null) => void; portrait?: boolean }) {
  // Paging may disable or remove the button that was pressed: the plan puts focus on the page title instead of losing it, but only when
  // it was lost, so paging by keyboard stays on the button that was pressed; on arrival it goes to the title, as on the other screens.
  const plan = useMealPlan({ timezone, date, onNavigate, focus: { takesFocusOnArrival: true } });
  const { days, previous, next, limit, heading } = plan;

  return (
    <div className="flex min-h-0 flex-col gap-4">
      {/* The paging row sits on the page, so its buttons are --card, as the plan under them is. */}
      <nav aria-label="Meals paging" className="flex h-12 flex-none items-center gap-2">
        <Button aria-label="Previous week" className="size-12 rounded-full bg-card p-0" disabled={previous === null} onClick={() => previous?.()}>
          <ChevronLeft aria-hidden className="size-6" strokeWidth={2.2} />
        </Button>
        <Button className="h-12 rounded-full bg-card px-5 text-[15px]" onClick={() => onNavigate(null)}>
          Today
        </Button>
        <Button aria-label="Next week" className="size-12 rounded-full bg-card p-0" disabled={next === null} onClick={() => next?.()}>
          <ChevronRight aria-hidden className="size-6" strokeWidth={2.2} />
        </Button>
        <h2 ref={heading} tabIndex={-1} className="ml-3 font-display text-[28px] leading-[34px] outline-none">
          {describePage(days)}
        </h2>
      </nav>
      {/* Always mounted, so a screen reader announces the text when it appears. */}
      <p role="status" className="text-lg empty:hidden">
        {limit}
      </p>
      {/* Keyed on the page, so a turned page starts with its sheet closed. */}
      <MealsGrid key={days[0]!.date} plan={plan} portrait={portrait} />
    </div>
  );
}

// The cell the sheet is open on: its Household date and slot, how it is named, and the Meal it holds.
export type Editing = MealSheetCell;

// A heading row of days over a row for each slot, each row starting with the slot's picture and name. Each cell is
// one button, at least 48 px either way, that opens the sheet; a planned Meal is on --everyone and an empty slot is a
// quiet plus on --muted. The rows share the height the screen has. In portrait the grid is turned: the slots across the
// top, a row for each day, the day's heading first, and the same cells. Until the Meals have been read (and after a first
// read that failed) the cells are disabled and show nothing, since a cell that looked empty and could be tapped would
// invite writing over a Meal that is only not read yet.
function MealsGrid({ plan, portrait }: { plan: ReturnType<typeof useMealPlan>; portrait: boolean }) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const { days, state, save, cellFor } = plan;
  const known = state === 'ready';
  const rows = MEAL_SLOTS;
  const template: CSSProperties = portrait
    ? // Turned: the days' column is 6 rem (the heading and the corner's "Loading"), the slots share the width and never narrow past 3 rem,
      // and the days share the height, each at least as tall as its Meal's words.
      { gridTemplateColumns: `6rem repeat(${rows.length}, minmax(3rem, 1fr))`, gridTemplateRows: `auto repeat(${days.length}, minmax(min-content, 1fr))` }
    : {
        // The slot column is 7 rem (at larger text no more than 112 px or 11 percent of the screen, whichever is more, so the days keep
        // their room) and the heading row 3.875 rem (the weekday's 18 px, 2, the 38 px date and 4 to spare); a day never narrows past a finger.
        gridTemplateColumns: `min(7rem, max(112px, 11vw)) repeat(${days.length}, minmax(3rem, 1fr))`,
        gridTemplateRows: `3.875rem repeat(${rows.length}, minmax(min-content, 1fr))`,
      };
  const slotHeading = ({ slot, label }: (typeof rows)[number]) => {
    const Picture = SLOT_PICTURES[slot];
    return (
      <h3 key={slot} className="flex min-w-0 flex-col items-center justify-center gap-1.5 text-[15px] leading-5 font-semibold">
        <span aria-hidden className="flex size-10 items-center justify-center rounded-full bg-everyone">
          <Picture className="size-[22px]" />
        </span>
        {label}
      </h3>
    );
  };
  const cell = (row: (typeof rows)[number], day: WallDay) => {
    const { meal, lead, sheet } = cellFor(day, row.slot);
    return (
      <Button
        key={`${day.date} ${row.slot}`}
        disabled={!known}
        onClick={() => setEditing(sheet)}
        // Corners of 14 and 10 px inside, as an event pill has; a Meal's words start at the top left and are
        // clamped to three lines (the whole of them are in the sheet), an empty slot's plus is in the middle.
        className={`h-auto min-h-12 min-w-0 rounded-[14px] p-[10px] text-left text-[15px] leading-[19px] font-medium whitespace-normal ${meal ? 'items-start justify-start bg-everyone' : 'text-muted-foreground'}`}
      >
        {/* The name a screen reader hears: "Dinner, Thursday 1: Tacos", or "Dinner, Thursday 1: nothing planned. Add a meal"; while the Meals are unknown, just "Dinner, Thursday 1". */}
        <span className="sr-only">{lead}</span>
        {meal ? (
          <span dir="auto" className="line-clamp-3 min-w-0 flex-1 text-start wrap-anywhere">{meal.title}</span>
        ) : (
          known && (
            <>
              <Plus aria-hidden className="size-[22px]" />
              <span className="sr-only">{NOTHING_PLANNED}</span>
            </>
          )
        )}
      </Button>
    );
  };

  return (
    <section aria-label="Meal plan" className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl bg-card">
      <ReadState of="meals" read={plan} say="failed" alert="p-4 text-xl" />
      {/* The padding is on the scrolling grid, so a focus ring has room inside what it clips. */}
      <div style={template} className="grid min-h-0 flex-1 gap-[8px] overflow-y-auto p-2">
        {/* The first read's own line, in the corner so the grid does not shift when it lands. */}
        <div className="flex items-center px-3 text-sm text-muted-foreground">
          <ReadState of="meals" read={plan} say="loading" className="text-sm" />
        </div>
        {/* Both forms are one flat list of keyed headings and cells, so turning the tablet moves them and keeps each cell. */}
        {portrait
          ? [
              ...rows.map(slotHeading),
              ...days.flatMap((day) => [<DayHeading key={day.date} day={day} />, ...rows.map((row) => cell(row, day))]),
            ]
          : [
              ...days.map((day) => <DayHeading key={day.date} day={day} />),
              ...rows.flatMap((row) => [slotHeading(row), ...days.map((day) => cell(row, day))]),
            ]}
      </div>
      {editing && (
        // Drawn in the body, outside the page it holds inert while it is open (InBody).
        <InBody>
          <MealSheet
            editing={editing}
            save={save}
            onClose={() => setEditing(null)}
            onSaved={() => setEditing(null)}
          />
        </InBody>
      )}
    </section>
  );
}

// A day's heading: the weekday over the date, which is the same 38 px tall on every day so the weekday words share a
// line. Today says so in words, puts its date in a 38 px --primary disc (the schedule's size, so two digits are not
// crowded) and sits on --muted, so it never rests on a tint alone.
function DayHeading({ day }: { day: WallDay }) {
  const { short } = WEEKDAYS[day.weekday]!;
  const date = Number(day.date.slice(8));
  return (
    <h3
      aria-current={day.isToday ? 'date' : undefined}
      aria-label={`${dayName(day)}${day.isToday ? ', today' : ''}`}
      className={`flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-[14px] font-normal ${day.isToday ? 'bg-muted' : ''}`}
    >
      <span className={`text-sm leading-[1.2857] ${day.isToday ? 'font-semibold' : 'font-medium text-muted-foreground'}`}>{day.isToday ? 'Today' : short}</span>
      <span className={`flex h-[38px] items-center justify-center font-display leading-none ${day.isToday ? 'size-[38px] rounded-full bg-primary text-[21px] text-primary-foreground' : 'text-[22px]'}`}>{date}</span>
    </h3>
  );
}

// Plans one cell, or clears it: a small sheet on the scrim with one text field, in the look of the Add event sheet.
// Focus moves onto the field on open, so the tablet's keyboard comes up at once, and back to the cell on close;
// Close, Cancel and Escape close it without writing, and so does a tap on the scrim while the field still holds what
// it opened with. A blank field is a clear.
export function MealSheet({ editing, save, onSaved, onClose }: { editing: Editing; save: (date: string, slot: MealSlot, title: string) => Promise<void>; onSaved: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(editing.meal?.title ?? '');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  // What a save that did not go through says: the Wall's one vocabulary for it (write-failure.ts).
  const failureWords = useFailureWords();
  // A stray tap on the scrim never throws away what was typed.
  const untouched = title === (editing.meal?.title ?? '');

  // The page behind is inert for as long as the sheet is open, and let go of before focus goes back to the cell (an inert element takes
  // no focus). The opener is noted first: making the page inert takes the focus off it.
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const release = holdBackground(appBehind());
    input.current?.focus();
    return () => {
      release();
      opener?.focus();
    };
  }, []);

  // A button that had focus is disabled while saving: focus then falls to the page behind (the
  // browser lets it go a moment after this runs, so a disabled button still counts as lost), and
  // Escape and Tab would no longer reach the sheet. Put it on the sheet, not the field, so a tapped
  // Save does not bring the keyboard back up.
  useEffect(() => {
    const active = document.activeElement;
    if (!dialog.current?.contains(active) || (active instanceof HTMLButtonElement && active.disabled)) dialog.current?.focus();
  }, [busy]);

  // A save in flight holds the sheet open, so a late save never closes some other sheet and a
  // failed one never reports to a sheet that is gone.
  const close = () => {
    if (!busy) onClose();
  };

  async function write(next: string) {
    setProblem('');
    setBusy(true);
    try {
      await save(editing.date, editing.slot, next);
      onSaved();
    } catch (error) {
      setProblem(failureWords(error));
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void write(title);
  }

  return (
    <div
      className={`fixed inset-0 z-20 flex items-center justify-center overflow-y-auto bg-scrim p-8 ${PHONE_SCRIM}`}
      // A press on the scrim must not take focus off the field: the browser would hand it to the page behind, and
      // Escape would then reach nothing.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) event.preventDefault();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && untouched) close();
      }}
    >
      <form
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="meal-sheet-title"
        tabIndex={-1}
        noValidate
        onSubmit={submit}
        onKeyDown={(event) => dialogKeys(event, close)}
        className={`flex w-full max-w-lg flex-col gap-[18px] rounded-[28px] bg-card p-6 outline-none ${PHONE_FRAME} phone:min-h-0`}
      >
        <SheetHandle />
        <div className="flex h-12 items-center justify-between gap-4">
          <h2 id="meal-sheet-title" className="font-display text-[30px] leading-9">
            {editing.heading}
          </h2>
          <Button variant="quiet" aria-label="Close" className="size-12 rounded-full p-0" disabled={busy} onClick={close}>
            <X aria-hidden className="size-[26px]" strokeWidth={2.2} />
          </Button>
        </div>
        {/* On a phone the field and what is said of it scroll between the title row and the buttons; on the Wall the box is not there
            (display: contents), and the sheet is as it was. */}
        <div className="contents phone:flex phone:min-h-0 phone:flex-col phone:gap-[18px] phone:overflow-y-auto">
          <label className="flex flex-col gap-2">
            <span className="text-[15px] leading-5 text-muted-foreground">Meal</span>
            <input ref={input} dir="auto" className="h-[60px] px-4 text-[19px]" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </label>
          <p role="alert" className="min-h-6 text-[15px] leading-5 font-medium empty:hidden">
            {problem}
          </p>
        </div>
        <div className="flex phone:flex-none flex-wrap items-center justify-end gap-3">
          {editing.meal && (
            <Button className="mr-auto h-14 px-6 text-[17px]" disabled={busy} onClick={() => void write('')}>
              Clear
            </Button>
          )}
          <Button variant="quiet" className="h-14 px-6 text-[17px]" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" className="h-14 min-w-32 px-6 text-[17px]" disabled={busy}>
            Save
          </Button>
        </div>
      </form>
    </div>
  );
}

// ---- The header's next meal -------------------------------------------------------------

// The header's room for the next meal, after the weather: it takes what the clock, the date, the weather and the
// marks leave, and holds the button against the marks. It is on the page whether or not there is a button, and before
// the Household is read (`timezone` null), so the marks stay at the far end. It is also a size container, which is how
// the button tells how much room it has: its words are cut short with an ellipsis, and when there is not even room for
// the picture and a few letters (11 rem, so a box of 12.5 with the gap) the button goes, before anything else in the header gives way. `onOpen` is null
// on the Meals screen, where the button is not drawn.
//
// The box takes back the header's gap on its left (-ml-6) and the button carries that gap itself (ml-6): an empty box
// then costs the header no second gap, which with both marks showing is the room the marks need.
export function HeaderNextMeal({ timezone, onOpen }: { timezone: string | null; onOpen: (() => void) | null }) {
  return <div className="@container -ml-6 flex min-w-0 flex-1 justify-end">{timezone && onOpen && <NextMealButton timezone={timezone} onOpen={onOpen} />}</div>;
}

// The first planned slot of today that is still ahead (nextMeal), as a 64 px button: the slot's picture on --everyone,
// the slot's words ("Dinner tonight") over the Meal's name, and a chevron. Nothing while today's Meals have not been
// read, and nothing when no slot ahead is planned. Read again when a Meal changes anywhere in the Household, so a Meal
// written on another screen lands within a second or two, and drawn again each minute and at Household midnight, so
// lunch gives way to the snack at 14:00 with no reload.
function NextMealButton({ timezone, onOpen }: { timezone: string; onOpen: () => void }) {
  const next = useNextMeal(timezone);
  if (!next) return null;
  const Picture = SLOT_PICTURES[next.slot];
  const words = nextMealWords(next.slot);
  return (
    <Button
      aria-label={`${words}: ${next.title}. Open meals`}
      onClick={onOpen}
      className="ml-6 hidden h-16 max-w-full min-w-0 gap-3 rounded-[20px] bg-card p-0 pr-3 pl-2 font-normal @min-[12.5rem]:flex"
    >
      <span aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-[14px] bg-everyone">
        <Picture className="size-6" />
      </span>
      <span className="flex min-w-0 flex-col text-left">
        <span className="truncate text-sm leading-[1.2857] text-muted-foreground">{words}</span>
        <span dir="auto" className="truncate font-display text-[22px] leading-7">{next.title}</span>
      </span>
      <ChevronRight aria-hidden className="size-[22px] text-muted-foreground" strokeWidth={2.2} />
    </Button>
  );
}
