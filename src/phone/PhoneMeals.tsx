import { Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { BeforeHousehold } from '../components/BeforeHousehold';
import { EmptyWords } from '../components/EmptyWords';
import { InBody } from '../components/InBody';
import { Button } from '../components/ui/button';
import { describeCell, mealsPageDate, pageDays, pageStart, paging, pagingWindowAround, shownDate, type WallDay, type WallRoute } from '../lib/calendar-occurrences';
import { focusTitleIfLost } from '../lib/focus';
import { mealGrid, mealsPickedDay, slotRowName, type Meal } from '../lib/meals';
import { pageWords } from '../lib/phone-calendar';
import { useHouseholdDay } from '../lib/wall-hooks';
import { dayName, SLOT_PICTURES, sheetFor, useMeals } from '../lib/use-meals';
import { MealSheet, type Editing } from '../MealsPage';
import type { PhoneScreenProps } from '../PhoneWall';
import { DayChips, Pager, PhoneCard } from './parts';
import { dayStartMs } from '../../supabase/functions/_shared/zoned-time.ts';
import { couldNotLoad } from '../lib/synced-read';

// The phone's Meals tab (spec 0004, "Meals"): the pager by week, then a card with seven day chips, the picked day's heading and its
// four slots as rows. It reads through the Meals screen's own reader (useMeals) and opens the Meals screen's own sheet (MealSheet), so
// saving and clearing a Meal are the tablet's, and nothing is read that the tablet does not read.

// One slot of the picked day: a 68 px button (taller only if the Meal's words take a second line). The slot's picture in a 40 px disc,
// the slot's name over the Meal or "Add a meal" with a plus. A planned Meal is on --everyone, an empty slot on --muted, so neither
// rests on a tint alone: the words say which.
export function SlotRow({ label, slot, day, meal, onOpen }: { label: string; slot: keyof typeof SLOT_PICTURES; day: WallDay; meal: Meal | null | undefined; onOpen: () => void }) {
  const Picture = SLOT_PICTURES[slot];
  return (
    <Button
      aria-label={slotRowName(label, dayName(day), meal)}
      disabled={meal === undefined}
      onClick={onOpen}
      className={`h-auto min-h-17 w-full justify-start gap-3 rounded-2xl px-3 py-2 text-left whitespace-normal ${meal ? 'bg-everyone' : 'bg-muted'}`}
    >
      <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-card">
        <Picture className="size-[22px]" />
      </span>
      <span aria-hidden className="flex min-w-0 flex-1 flex-col text-left">
        <span className="text-[15px] leading-5 font-medium text-muted-foreground">{label}</span>
        {meal ? (
          <span dir="auto" className="line-clamp-2 text-[17px] leading-6 font-semibold wrap-anywhere">
            {meal.title}
          </span>
        ) : (
          meal === null && <span className="text-[17px] leading-6 font-medium text-muted-foreground">Add a meal</span>
        )}
      </span>
      {meal === null && <Plus aria-hidden className="size-6 shrink-0 text-muted-foreground" strokeWidth={2.4} />}
    </Button>
  );
}

export function PhoneMeals({ route, timezone, view, openMeals }: PhoneScreenProps & { route: Extract<WallRoute, { view: 'meals' }> }) {
  if (!timezone) return <BeforeHousehold label="Meals" failed={view.failed} words={couldNotLoad('meals')} />;
  return <MealsWeek timezone={timezone} date={route.date} onNavigate={openMeals} />;
}

// The week the screen is on, laid out as the Meals screen lays it out: `date` is the page's anchor (null for this week), pulled into the
// window the calendar pages within and snapped to its Sunday. `onNavigate` opens a week by its Sunday, or null for the week that holds today.
function MealsWeek({ timezone, date, onNavigate }: { timezone: string; date: string | null; onNavigate: (date: string | null) => void }) {
  const today = useHouseholdDay(timezone).date;
  const now = new Date(dayStartMs(today, timezone));
  const anchor = pageStart('week', shownDate(date, today));
  const days = pageDays('week', anchor, timezone, now);
  const { previous, next } = paging('week', anchor, pagingWindowAround(today));
  const open = (week: string) => onNavigate(mealsPageDate(week, today));

  // Paging may disable the button that was pressed: put focus on the pager's words instead of losing it (and only if it was lost: paging by keyboard stays on the button pressed). Only after the week the person
  // chose has changed (`date`, never the computed `anchor`, which also moves by itself at the week's turn while the page follows this
  // week), never when the screen opens (which would scroll the page), StrictMode's second run of the effect included: the date it saw last is kept.
  const heading = useRef<HTMLHeadingElement>(null);
  const seen = useRef(date);
  useEffect(() => {
    if (seen.current === date) return;
    seen.current = date;
    focusTitleIfLost(heading.current, { preventScroll: true });
  }, [date]);
  // The week's card is keyed on the anchor, so when it moves by itself (the week turning) it is new and focus inside it is gone: it goes
  // to the pager's words then, and focus that is anywhere else is left alone.
  useEffect(() => focusTitleIfLost(heading.current, { preventScroll: true }), [anchor]);

  return (
    <div className="flex flex-col gap-3">
      <Pager words={pageWords(days, today)} previousLabel="Previous week" nextLabel="Next week" onPrevious={previous ? () => open(previous) : null} onNext={next ? () => open(next) : null} headingRef={heading} />
      {/* Always mounted, so a screen reader announces the words when they appear. */}
      <p role="status" className="text-base text-muted-foreground empty:hidden">
        {previous === null ? 'This is as far back as the meal plan goes.' : next === null ? 'This is as far ahead as the meal plan goes.' : ''}
      </p>
      {/* Keyed on the week, so a turned page never shows the last week's Meals or keeps its picked day. */}
      <MealsDay key={days[0]!.date} days={days} today={today} />
    </div>
  );
}

// One week's card: the chips, the picked day and its four slots. The picked day is the screen's own state; until a chip is pressed it
// is today when the week holds it, else the Sunday (mealsPickedDay), and it follows Household midnight.
function MealsDay({ days, today }: { days: WallDay[]; today: string }) {
  const dates = days.map((day) => day.date);
  const [choice, setChoice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const { meals, failed, save } = useMeals(dates[0]!, dates[6]!);
  const known = meals !== null;
  const picked = mealsPickedDay(dates, choice, today);
  const day = days[dates.indexOf(picked)]!;
  const rows = mealGrid(meals ?? [], [picked]);

  return (
    <PhoneCard label="Meal plan">
      <DayChips label="Days of this week" dates={dates} today={today} picked={picked} onPick={setChoice} />
      <h3 className="px-1 text-[15px] leading-5 font-medium text-muted-foreground">{describeCell(picked, null)}</h3>
      {failed && !known && (
        <p role="alert" className="px-1 text-base">
          {couldNotLoad('meals')}
        </p>
      )}
      {!known && !failed && <EmptyWords className="px-1">Loading</EmptyWords>}
      {rows.map((row) => {
        const meal = known ? row.cells[0]! : undefined;
        return (
          <SlotRow
            key={row.slot}
            label={row.label}
            slot={row.slot}
            day={day}
            meal={meal}
            onOpen={() => setEditing(sheetFor(day, row, meal ?? null))}
          />
        );
      })}
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
    </PhoneCard>
  );
}
