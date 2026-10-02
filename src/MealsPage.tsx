import { ChevronLeft, ChevronRight, Cookie, Moon, Plus, Sun, Sunrise, X, type LucideIcon } from 'lucide-react';
import { Fragment, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Button } from './components/ui/button';
import { dayStartMs, describePage, mealsPageDate, pageDays, pageStart, paging, pagingWindowAround, shownDate, type WallDay } from './lib/calendar-occurrences';
import { useChangeTick } from './lib/change-feed';
import { dialogKeys } from './lib/dialog';
import { loadMeals, mealGrid, nextMeal, nextMealWords, setMeal, type Meal, type MealSlot } from './lib/meals';
import { householdDay, WEEKDAYS } from './lib/routines';
import { supabase } from './lib/supabase';
import { useHouseholdDay, useNow } from './lib/wall-hooks';

// Meals on the wall (CONTEXT.md: Meal): the Meals screen, a week by slot, and the header's button for the
// next meal of today. Written by a Household Account or a Device, whichever session `supabase` holds.

// A change heard from the server reads at once; this slow read is the backstop for one that was
// missed while the connection was down. A read that failed is tried again sooner, as the calendar's is.
const REFRESH_MS = 60_000;
const RETRY_MS = 5_000;
// What each read here listens to: a Meal changed anywhere in the Household.
const MEAL_TABLES = ['meals'] as const;

// The picture each slot is marked with, in the plan's rows and on the header's button.
const SLOT_PICTURES: Record<MealSlot, LucideIcon> = { breakfast: Sunrise, lunch: Sun, dinner: Moon, snack: Cookie };

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

// The week the screen is on: `date` is the page's anchor (null for this week, which the screen then
// follows as the weeks turn), pulled into the window the calendar pages within and snapped to its
// Sunday, as the week view does. `onNavigate` opens a week by its Sunday, or by null when it holds
// today (Today, and paging back onto it), which a Wall left there then follows as the weeks turn.
export function MealsScreen({ timezone, date, onNavigate }: { timezone: string; date: string | null; onNavigate: (date: string | null) => void }) {
  const today = useHouseholdDay(timezone).date;
  // The page is laid out from the start of today, so its days and the mark on today agree.
  const now = new Date(dayStartMs(today, timezone));
  const anchor = pageStart('week', shownDate(date, today));
  const days = pageDays('week', anchor, timezone, now);
  const { previous, next } = paging('week', anchor, pagingWindowAround(today));
  const open = (week: string) => onNavigate(mealsPageDate(week, today));
  // Paging may disable or remove the button that was pressed: put focus on the page title instead of losing it.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [anchor]);

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {/* The paging row sits on the page, so its buttons are --card, as the plan under them is. */}
      <nav aria-label="Meals paging" className="flex h-12 flex-none items-center gap-2">
        <Button aria-label="Previous week" className="size-12 rounded-full bg-card p-0" disabled={previous === null} onClick={() => previous && open(previous)}>
          <ChevronLeft aria-hidden className="size-6" strokeWidth={2.2} />
        </Button>
        <Button className="h-12 rounded-full bg-card px-5 text-[15px]" onClick={() => onNavigate(null)}>
          Today
        </Button>
        <Button aria-label="Next week" className="size-12 rounded-full bg-card p-0" disabled={next === null} onClick={() => next && open(next)}>
          <ChevronRight aria-hidden className="size-6" strokeWidth={2.2} />
        </Button>
        <h2 ref={heading} tabIndex={-1} className="ml-3 font-display text-[28px] leading-[34px] outline-none">
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

// A heading row of days over a row for each slot, each row starting with the slot's picture and name. Each cell is
// one button, at least 48 px either way, that opens the sheet; a planned Meal is on --everyone and an empty slot is a
// quiet plus on --muted. The rows share the height the screen has. Until the Meals have been read (and after a first
// read that failed) the cells are disabled and show nothing, since a cell that looked empty and could be tapped would
// invite writing over a Meal that is only not read yet.
function MealsGrid({ days }: { days: WallDay[] }) {
  const [saves, setSaves] = useState(0);
  const [editing, setEditing] = useState<Editing | null>(null);
  const { meals, failed } = useMeals(days[0]!.date, days[days.length - 1]!.date, saves);
  const known = meals !== null;
  const rows = mealGrid(meals ?? [], days.map((day) => day.date));
  const template: CSSProperties = {
    // The slot column is 7 rem and the heading row 3.5 rem; a day never narrows past a finger.
    gridTemplateColumns: `7rem repeat(${days.length}, minmax(3rem, 1fr))`,
    gridTemplateRows: `3.5rem repeat(${rows.length}, minmax(min-content, 1fr))`,
  };

  return (
    <section aria-label="Meal plan" className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl bg-card">
      {failed && !known && (
        <p role="alert" className="p-4 text-xl">
          Could not load meals. Check your connection.
        </p>
      )}
      {/* The padding is on the scrolling grid, so a focus ring has room inside what it clips. */}
      <div style={template} className="grid min-h-0 flex-1 gap-2 overflow-y-auto p-2.5">
        {/* The first read's own line, in the corner so the grid does not shift when it lands. */}
        <div className="flex items-center px-3 text-sm text-muted-foreground">{!known && !failed ? 'Loading' : null}</div>
        {days.map((day) => (
          <DayHeading key={day.date} day={day} />
        ))}
        {rows.map((row) => {
          const Picture = SLOT_PICTURES[row.slot];
          return (
            <Fragment key={row.slot}>
              <h3 className="flex min-w-0 flex-col items-center justify-center gap-1.5 text-[15px] leading-5 font-semibold">
                <span aria-hidden className="flex size-10 items-center justify-center rounded-full bg-everyone">
                  <Picture className="size-[22px]" />
                </span>
                {row.label}
              </h3>
              {row.cells.map((meal, index) => {
                const day = days[index]!;
                const heading = `${row.label}, ${dayLabel(day)}`;
                return (
                  <Button
                    key={day.date}
                    disabled={!known}
                    onClick={() => setEditing({ date: day.date, slot: row.slot, heading, meal })}
                    // Corners of 14 and 10 px inside, as an event pill has; a Meal's words start at the top left and are
                    // clamped to three lines (the whole of them are in the sheet), an empty slot's plus is in the middle.
                    className={`h-auto min-h-12 min-w-0 rounded-[14px] p-2.5 text-left text-[15px] leading-[19px] font-medium whitespace-normal ${meal ? 'items-start justify-start bg-everyone' : 'text-muted-foreground'}`}
                  >
                    {/* The name a screen reader hears: "Dinner, Thu 1: Tacos", or "nothing planned"; while the Meals are unknown, just "Dinner, Thu 1". */}
                    <span className="sr-only">{known ? `${heading}: ` : heading}</span>
                    {meal ? (
                      <span dir="auto" className="line-clamp-3 min-w-0 flex-1 text-start wrap-anywhere">{meal.title}</span>
                    ) : (
                      known && (
                        <>
                          <Plus aria-hidden className="size-[22px]" />
                          <span className="sr-only">nothing planned</span>
                        </>
                      )
                    )}
                  </Button>
                );
              })}
            </Fragment>
          );
        })}
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

// A day's heading: the weekday over the date, which is the same 32 px tall on every day so the weekday words share a
// line. Today says so in words, puts its date in a --primary disc and sits on --muted, so it never rests on a tint alone.
function DayHeading({ day }: { day: WallDay }) {
  const { name, short } = WEEKDAYS[day.weekday]!;
  const date = Number(day.date.slice(8));
  return (
    <h3
      aria-current={day.isToday ? 'date' : undefined}
      aria-label={`${name} ${date}${day.isToday ? ', today' : ''}`}
      className={`flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-[14px] font-normal ${day.isToday ? 'bg-muted' : ''}`}
    >
      <span className={`text-sm leading-[18px] ${day.isToday ? 'font-semibold' : 'font-medium text-muted-foreground'}`}>{day.isToday ? 'Today' : short}</span>
      <span className={`flex h-8 items-center justify-center font-display text-[22px] leading-none ${day.isToday ? 'size-8 rounded-full bg-primary text-primary-foreground' : ''}`}>{date}</span>
    </h3>
  );
}

// Plans one cell, or clears it: a small sheet on the scrim with one text field, in the look of the Add event sheet.
// Focus moves onto the field on open, so the tablet's keyboard comes up at once, and back to the cell on close;
// Close, Cancel and Escape close it without writing, and so does a tap on the scrim while the field still holds what
// it opened with. A blank field is a clear.
function MealSheet({ editing, onSaved, onClose }: { editing: Editing; onSaved: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(editing.meal?.title ?? '');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  // A stray tap on the scrim never throws away what was typed.
  const untouched = title === (editing.meal?.title ?? '');

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
      className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-scrim p-4 sm:items-center sm:p-8"
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
        className="flex w-full max-w-lg flex-col gap-[18px] rounded-[28px] bg-card p-6 outline-none"
      >
        <div className="flex h-12 items-center justify-between gap-4">
          <h2 id="meal-sheet-title" className="font-display text-[30px] leading-9">
            {editing.heading}
          </h2>
          <Button variant="quiet" aria-label="Close" className="size-12 rounded-full p-0" disabled={busy} onClick={close}>
            <X aria-hidden className="size-[26px]" strokeWidth={2.2} />
          </Button>
        </div>
        <label className="flex flex-col gap-2">
          <span className="text-[15px] leading-5 text-muted-foreground">Meal</span>
          <input ref={input} dir="auto" className="h-[60px] px-4 text-[19px]" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </label>
        <p role="alert" className="min-h-6 text-lg empty:hidden">
          {problem}
        </p>
        <div className="flex flex-wrap items-center justify-end gap-3">
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
// marks leave, none of which shrinks, and holds the button against the marks. It is on the page whether or not there
// is a button, so the marks stay at the far end. It is also a size container, which is how the button tells how much
// room it has: its words are cut short with an ellipsis, and when there is not even room for the picture and a few
// letters (11 rem) the button goes, before anything else in the header gives way. `onOpen` is null on the Meals
// screen, where the button is not drawn.
export function HeaderNextMeal({ timezone, onOpen }: { timezone: string; onOpen: (() => void) | null }) {
  return <div className="@container flex min-w-0 flex-1 justify-end">{onOpen && <NextMealButton timezone={timezone} onOpen={onOpen} />}</div>;
}

// The first planned slot of today that is still ahead (nextMeal), as a 64 px button: the slot's picture on --everyone,
// the slot's words ("Dinner tonight") over the Meal's name, and a chevron. Nothing while today's Meals have not been
// read, and nothing when no slot ahead is planned. Read again when a Meal changes anywhere in the Household, so a Meal
// written on another screen lands within a second or two, and drawn again each minute and at Household midnight, so
// lunch gives way to the snack at 14:00 with no reload.
function NextMealButton({ timezone, onOpen }: { timezone: string; onOpen: () => void }) {
  const now = useNow(timezone);
  const today = householdDay(timezone, now).date;
  const { meals } = useMeals(today, today);
  const next = meals && nextMeal(meals, now, timezone);
  if (!next) return null;
  const Picture = SLOT_PICTURES[next.slot];
  const words = nextMealWords(next.slot);
  return (
    <Button
      aria-label={`${words}: ${next.title}. Open Meals`}
      onClick={onOpen}
      className="hidden h-16 max-w-full min-w-0 gap-3 rounded-[20px] bg-card p-0 pr-3 pl-2 font-normal @min-[11rem]:flex"
    >
      <span aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-[14px] bg-everyone">
        <Picture className="size-6" />
      </span>
      <span className="flex min-w-0 flex-col text-left">
        <span className="truncate text-sm leading-[18px] text-muted-foreground">{words}</span>
        <span dir="auto" className="truncate font-display text-[22px] leading-7">{next.title}</span>
      </span>
      <ChevronRight aria-hidden className="size-[22px] text-muted-foreground" strokeWidth={2.2} />
    </Button>
  );
}
