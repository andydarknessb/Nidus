import { Plus } from 'lucide-react';
import { Fragment, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { clampToWindow, dayStartMs, describePage, pageDays, pageStart, paging, pagingWindow, type WallDay } from './lib/calendar-occurrences';
import { useChangeTick } from './lib/change-feed';
import { dialogKeys } from './lib/dialog';
import { watchHouseholdDay } from './lib/household-day';
import { loadMeals, mealGrid, setMeal, type Meal, type MealSlot } from './lib/meals';
import { householdDay, WEEKDAYS } from './lib/routines';
import { supabase } from './lib/supabase';

// Meals on the wall (CONTEXT.md: Meal): the Meals screen, a week by slot, and the home screen's
// card of today's. Written by a Household Account or a Device, whichever session `supabase` holds.

// A change heard from the server reads at once; this slow read is the backstop for one that was
// missed while the connection was down. A read that failed is tried again sooner, as the calendar's is.
const REFRESH_MS = 60_000;
const RETRY_MS = 5_000;
// What each read here listens to: a Meal changed anywhere in the Household.
const MEAL_TABLES = ['meals'] as const;

const PAGE_BUTTON = 'min-h-12 rounded-lg border border-border px-6 text-lg font-medium disabled:opacity-50';
const field = 'min-h-12 w-full rounded-lg border border-input bg-background px-3 text-lg text-foreground';
const action = 'min-h-12 rounded-lg px-6 text-lg font-medium';
const quiet = `${action} border border-border disabled:opacity-40`;

// Today's Household date, moved on at Household midnight with no refresh.
function useToday(timezone: string): string {
  const [today, setToday] = useState(() => householdDay(timezone).date);
  useEffect(() => {
    setToday(householdDay(timezone).date);
    return watchHouseholdDay(timezone, (day) => setToday(day.date));
  }, [timezone]);
  return today;
}

// The Meals from `from` to `to` (Household dates), read again when a Meal changes anywhere in the
// Household, when `saves` goes up (a save made here) and every minute, or after five seconds when
// the last read failed. `meals` is null until a read has landed; a failed read keeps what is shown.
// Callers are keyed on the span, so a turned page never shows the last page's Meals.
function useMeals(from: string, to: string, saves = 0): { meals: Meal[] | null; failed: boolean } {
  const [read, setRead] = useState<{ meals: Meal[] | null; failed: boolean }>({ meals: null, failed: false });
  const changes = useChangeTick(MEAL_TABLES);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function load() {
      let delay = REFRESH_MS;
      try {
        const meals = await loadMeals(supabase, from, to);
        if (live) setRead({ meals, failed: false });
      } catch {
        if (live) setRead((prev) => ({ ...prev, failed: true }));
        delay = RETRY_MS;
      }
      if (live) timer = setTimeout(() => void load(), delay);
    }

    void load();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [from, to, saves, changes]);
  return read;
}

// "Thu 1": a day as the grid names it.
function dayLabel(day: WallDay): string {
  return `${WEEKDAYS[day.weekday]!.short} ${Number(day.date.slice(8))}`;
}

// ---- The Meals screen: a week by slot ------------------------------------------------

// The week the screen is on: `date` is the page's anchor (null for today), pulled into the window
// the calendar pages within and snapped to its Sunday, as the week view does.
export function MealsScreen({ timezone, date, onNavigate }: { timezone: string; date: string | null; onNavigate: (date: string) => void }) {
  const today = useToday(timezone);
  // The page is laid out from the start of today, so its window, its days and the mark on today agree.
  const now = new Date(dayStartMs(today, timezone));
  const window = pagingWindow(timezone, now);
  const anchor = pageStart('week', clampToWindow(date ?? today, window));
  const days = pageDays('week', anchor, timezone, now);
  const { previous, next } = paging('week', anchor, window);
  // Paging may disable or remove the button that was pressed: put focus on the page title instead of losing it.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [anchor]);

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <nav aria-label="Meals paging" className="flex flex-wrap items-center gap-4">
        <button type="button" className={PAGE_BUTTON} disabled={previous === null} onClick={() => previous && onNavigate(previous)}>
          Previous week
        </button>
        <button type="button" className={PAGE_BUTTON} onClick={() => onNavigate(pageStart('week', today))}>
          Today
        </button>
        <button type="button" className={PAGE_BUTTON} disabled={next === null} onClick={() => next && onNavigate(next)}>
          Next week
        </button>
        <h2 ref={heading} tabIndex={-1} className="ml-2 text-2xl font-semibold outline-none">
          {describePage(days)}
        </h2>
      </nav>
      {/* Always mounted, so a screen reader announces the text when it appears. Meals page within the
          calendar's window but are not what the mirror keeps, so these say only where the plan ends. */}
      <p role="status" className="text-lg empty:hidden">
        {previous === null
          ? 'This is as far back as the meal plan goes.'
          : next === null
            ? 'This is as far ahead as the meal plan goes.'
            : ''}
      </p>
      {/* Keyed on the page so a turned page never shows the last page's Meals, and a failed read says so. */}
      <MealsGrid key={days[0]!.date} days={days} />
    </div>
  );
}

// The cell the sheet is open on: its Household date and slot, how it is named, and the Meal it holds.
type Editing = { date: string; slot: MealSlot; heading: string; meal: Meal | null };

// A heading row of days over a row for each slot. Each cell is one button, at least 48 px tall,
// that opens the sheet; the rows share the height the screen has. Until the Meals have been read
// (and after a first read that failed) the cells are disabled and show nothing, since a cell that
// looked empty and could be tapped would invite writing over a Meal that is only not read yet.
function MealsGrid({ days }: { days: WallDay[] }) {
  const [saves, setSaves] = useState(0);
  const [editing, setEditing] = useState<Editing | null>(null);
  const { meals, failed } = useMeals(days[0]!.date, days[days.length - 1]!.date, saves);
  const known = meals !== null;
  const rows = mealGrid(meals ?? [], days.map((day) => day.date));
  const template: CSSProperties = {
    gridTemplateColumns: `8rem repeat(${days.length}, minmax(0, 1fr))`,
    gridTemplateRows: `auto repeat(${rows.length}, minmax(min-content, 1fr))`,
  };

  return (
    <section aria-label="Meals" className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border">
      {failed && !known && (
        <p role="alert" className="p-4 text-xl">
          Could not load meals. Check your connection.
        </p>
      )}
      <div style={template} className="grid min-h-0 flex-1 overflow-y-auto">
        {/* The first read's own line, in the corner so the grid does not shift when it lands. */}
        <div className="flex items-center px-3 text-lg">{!known && !failed ? 'Loading' : null}</div>
        {days.map((day) => (
          <DayHeading key={day.date} day={day} />
        ))}
        {rows.map((row) => (
          <Fragment key={row.slot}>
            <div className="flex items-center border-t border-border px-3 text-xl font-semibold">{row.label}</div>
            {row.cells.map((meal, index) => {
              const day = days[index]!;
              const heading = `${row.label}, ${dayLabel(day)}`;
              return (
                <button
                  key={day.date}
                  type="button"
                  disabled={!known}
                  onClick={() => setEditing({ date: day.date, slot: row.slot, heading, meal })}
                  // The inset ring stays inside the cell, where the scrolling grid cannot clip it.
                  className={`flex min-h-12 w-full items-center justify-center border-t border-l border-border px-2 py-2 text-center text-lg leading-snug focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-foreground ${day.isToday ? 'bg-muted/60' : ''}`}
                >
                  {/* The name a screen reader hears: "Dinner, Thu 1: Tacos", or "nothing planned"; while the Meals are unknown, just "Dinner, Thu 1". */}
                  <span className="sr-only">{known ? `${heading}: ` : heading}</span>
                  {meal ? (
                    <span className="line-clamp-3 min-w-0 wrap-anywhere">{meal.title}</span>
                  ) : (
                    known && (
                      <>
                        <Plus aria-hidden className="size-6 shrink-0" />
                        <span className="sr-only">nothing planned</span>
                      </>
                    )
                  )}
                </button>
              );
            })}
          </Fragment>
        ))}
      </div>
      {editing && (
        <MealSheet
          editing={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setSaves((count) => count + 1);
          }}
        />
      )}
    </section>
  );
}

// Today's column is marked by an underline and the word "today" for a screen reader, never by its
// tint alone.
function DayHeading({ day }: { day: WallDay }) {
  return (
    <h3
      aria-current={day.isToday ? 'date' : undefined}
      className={`border-l border-border px-2 py-3 text-center text-2xl font-semibold ${day.isToday ? 'bg-muted/60 underline decoration-4 underline-offset-8' : ''}`}
    >
      {dayLabel(day)}
      {day.isToday && <span className="sr-only"> (today)</span>}
    </h3>
  );
}

// Plans one cell, or clears it: a small sheet with one text field. Focus moves onto the field on
// open, so the tablet's keyboard comes up at once, and back to the cell on close; Escape and the
// backdrop close it without writing. A blank field is a clear.
function MealSheet({ editing, onSaved, onClose }: { editing: Editing; onSaved: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(editing.meal?.title ?? '');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => opener?.focus();
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
      await setMeal(supabase, editing.date, editing.slot, next);
      onSaved();
    } catch {
      setProblem('Could not save the meal. Check your connection and try again.');
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void write(title);
  }

  return (
    <div
      className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-background/90 p-4 sm:items-center sm:p-8"
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
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
        className="flex w-full max-w-lg flex-col gap-5 rounded-xl border-2 border-border bg-card p-6 outline-none"
      >
        <h2 id="meal-sheet-title" className="text-3xl font-semibold">
          {editing.heading}
        </h2>
        <label className="flex flex-col gap-2 text-lg">
          Meal
          <input ref={input} className={field} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </label>
        <p role="alert" className="min-h-6 text-lg empty:hidden">
          {problem}
        </p>
        <div className="flex flex-wrap gap-3">
          <button type="submit" className={`${action} bg-primary text-primary-foreground disabled:opacity-40`} disabled={busy}>
            Save
          </button>
          {editing.meal && (
            <button type="button" className={quiet} disabled={busy} onClick={() => void write('')}>
              Clear
            </button>
          )}
          <button type="button" className={quiet} disabled={busy} onClick={close}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

// ---- The home screen's card -----------------------------------------------------------

// The home screen's card of today's Meals, for the right rail above the Routines: the slots planned
// for today, in slot order. Nothing at all when none is planned or today's Meals have not been
// read, so a Household that plans no meals never sees an empty card. It moves on to the new day
// at Household midnight and reads that day's Meals, with no reload.
export function TodaysMealsCard({ timezone }: { timezone: string }) {
  const today = useToday(timezone);
  // Keyed on the day, so yesterday's Meals are never shown as today's.
  return <TodaysMeals key={today} date={today} />;
}

function TodaysMeals({ date }: { date: string }) {
  const { meals } = useMeals(date, date);
  const planned = mealGrid(meals ?? [], [date]).flatMap(({ slot, label, cells }) => (cells[0] ? [{ slot, label, title: cells[0].title }] : []));
  if (planned.length === 0) return null;

  return (
    <aside aria-label="Today's meals" className="flex flex-col gap-2 rounded-xl border border-border p-4">
      <h2 className="text-2xl font-semibold">Today&apos;s meals</h2>
      <ul className="flex flex-col gap-1 text-lg">
        {planned.map(({ slot, label, title }) => (
          <li key={slot} className="flex gap-3">
            <span className="w-28 shrink-0 font-semibold">{label}</span>
            <span className="line-clamp-3 min-w-0 wrap-anywhere">{title}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
