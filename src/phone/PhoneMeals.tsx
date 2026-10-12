import { Plus } from 'lucide-react';
import { useState } from 'react';
import { BeforeHousehold } from '../components/BeforeHousehold';
import { InBody } from '../components/InBody';
import { ReadState } from '../components/ReadState';
import { Button } from '../components/ui/button';
import type { WallRoute } from '../lib/wall-routes';
import { dateWords } from '../../supabase/functions/_shared/event-words.ts';
import { MEAL_SLOTS, type Meal } from '../lib/meals';
import { SLOT_PICTURES, useMealPlan } from '../lib/use-meal-plan';
import { MealSheet, type Editing } from '../MealsPage';
import type { PhoneScreenProps } from '../PhoneWall';
import { DayChips, Pager, PhoneCard } from './parts';

// The phone's Meals tab (spec 0004, "Meals"): the pager by week, then a card with seven day chips, the picked day's heading and its
// four slots as rows. It reads through the Meals screen's own reader (useMealPlan) and opens the Meals screen's own sheet (MealSheet), so
// saving and clearing a Meal are the tablet's, and nothing is read that the tablet does not read.

// One slot of the picked day: a 68 px button (taller only if the Meal's words take a second line). The slot's picture in a 40 px disc,
// the slot's name over the Meal or "Add a meal" with a plus. A planned Meal is on --everyone, an empty slot on --muted, so neither
// rests on a tint alone: the words say which.
// `heard` is the name a screen reader hears (cellFor).
export function SlotRow({ label, slot, meal, heard, onOpen }: { label: string; slot: keyof typeof SLOT_PICTURES; meal: Meal | null | undefined; heard: string; onOpen: () => void }) {
  const Picture = SLOT_PICTURES[slot];
  return (
    <Button
      aria-label={heard}
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
  if (!timezone) return <BeforeHousehold label="Meals" failed={view.failed} of="meals" />;
  return <MealsWeek timezone={timezone} date={route.date} onNavigate={openMeals} />;
}

// The week the screen is on, laid out as the Meals screen lays it out: `date` is the page's anchor (null for this week), pulled into the
// window the calendar pages within and snapped to its Sunday. `onNavigate` opens a week by its Sunday, or null for the week that holds today.
function MealsWeek({ timezone, date, onNavigate }: { timezone: string; date: string | null; onNavigate: (date: string | null) => void }) {
  // Paging may disable the button that was pressed: the plan puts focus on the pager's words instead of losing it (and only if it was
  // lost: paging by keyboard stays on the button pressed). It never moves when the screen opens, which would scroll the page.
  const plan = useMealPlan({ timezone, date, onNavigate, focus: { takesFocusOnArrival: false, preventScroll: true } });
  const { days, previous, next, limit, heading, words } = plan;

  return (
    <div className="flex flex-col gap-3">
      <Pager words={words} previousLabel="Previous week" nextLabel="Next week" onPrevious={previous} onNext={next} headingRef={heading} />
      {/* Always mounted, so a screen reader announces the words when they appear. */}
      <p role="status" className="text-base text-muted-foreground empty:hidden">
        {limit}
      </p>
      {/* Keyed on the week, so a turned page starts with its sheet closed. */}
      <MealsDay key={days[0]!.date} plan={plan} />
    </div>
  );
}

// One week's card: the chips, the picked day and its four slots. The picked day is the plan's (until a chip is pressed it is today when the
// week holds it, else the Sunday, and it follows Household midnight); the sheet's state is the card's own.
function MealsDay({ plan }: { plan: ReturnType<typeof useMealPlan> }) {
  const { days, today, picked: day, pick, save, cellFor } = plan;
  const [editing, setEditing] = useState<Editing | null>(null);
  const picked = day.date;

  return (
    <PhoneCard label="Meal plan">
      <DayChips label="Days of this week" dates={days.map((entry) => entry.date)} today={today} picked={picked} onPick={pick} />
      <h3 className="px-1 text-[15px] leading-5 font-medium text-muted-foreground">{dateWords.cell(picked, null)}</h3>
      <ReadState of="meals" read={plan} className="px-1" alert="px-1 text-base" />
      {MEAL_SLOTS.map(({ slot, label }) => {
        const { meal, heard, sheet } = cellFor(day, slot);
        return <SlotRow key={slot} label={label} slot={slot} meal={meal} heard={heard} onOpen={() => setEditing(sheet)} />;
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
