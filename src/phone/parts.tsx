import { cn } from 'cn';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import { BEYOND_RANGE, HATCH } from '../components/MonthCell';
import { Button } from '../components/ui/button';
import { WEEKDAYS } from '../lib/routines';

// The parts the phone's screens are made of (docs/look.md, "The phone"; spec 0004): seven day chips, a control of a few, a
// pager, a row that scrolls sideways and a card. Each is plain: it takes words and handlers and knows nothing of the data a
// screen reads, so the screens that run in parallel after the shell (src/phone/) build on them without reaching into each other.
// Colours are tokens only, and nothing here branches on the mode.

// ---- Targets that touch ------------------------------------------------------------------------

// A target at least 48 wide and tall may not have a gap next to it, so a chip or a choice in a control of a few touches its
// neighbours and draws the Selected look 2 px inside itself, on an inner span (the Day view's blocks do the same): the button is
// the target, the face is what is seen, and two picked-looking things never read as one. The button's own Selected look is switched
// off, the span's comes from `aria-pressed` on the button (`group-aria-pressed`), and the focus ring is drawn inside the button, so
// the row that scrolls does not clip it.
export const TOUCHING = 'group rounded-[14px] p-0.5 selected:bg-transparent selected:ring-0 active:bg-transparent focus-visible:-outline-offset-2';
export const FACE = 'flex size-full items-center justify-center rounded-xl group-aria-pressed:bg-accent group-aria-pressed:font-semibold group-aria-pressed:ring-2 group-aria-pressed:ring-foreground group-aria-pressed:ring-inset';

// ---- Day chips ---------------------------------------------------------------------------------

const weekdayOf = (date: string) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!;
const dayOfMonth = (date: string) => Number(date.slice(8));

// What a chip is called: the weekday in full and the date, "Friday 2", and ", today" for today. What is drawn says "Fri" or "Today"
// over the number, so a name spoken from the screen ("Friday 2") finds it.
function dayChipName(date: string, today: string): string {
  return `${weekdayOf(date).name} ${dayOfMonth(date)}${date === today ? ', today' : ''}`;
}

// Seven day chips sharing the width of their row, each 64 tall: the weekday over the date, and for today the word "Today" over the
// date in a 34 px --primary disc, which says `aria-current="date"`. The picked one is pressed (`aria-pressed`) and takes the
// Selected look. `dates` are Household dates ('YYYY-MM-DD'), seven for a week, in the order drawn; `today` is the Household's
// today, which only says which chip is today's, so a week that does not hold it has none. `label` names the group ("Days of this
// week").
//
// The targets are at least 48 wide and touch, as the Day view's blocks do: the Selected fill and ring are drawn 2 px inside each
// button (its inner span), so two chips never read as one. The row bleeds over the 12 px padding of the card it sits in (-mx-3), so
// at 390 px a chip is about 51 wide. A row narrower than seven chips (7 x 48 = 336) scrolls sideways, as the phone's rows do.
//
// `canPick` says which days can be picked; one that cannot (a day beyond the calendar's range) is no button but the hatched cell the
// tablet's Month grid draws for it, which says so. Left out, every day can be picked.
export function DayChips({
  label,
  dates,
  today,
  picked,
  onPick,
  canPick = () => true,
}: {
  label: string;
  dates: readonly string[];
  today: string;
  picked: string;
  onPick: (date: string) => void;
  canPick?: (date: string) => boolean;
}) {
  return (
    <SideScroll label={label} gap="gap-0" className="-mx-3 py-0">
      {dates.map((date) => {
        const isToday = date === today;
        if (!canPick(date)) {
          return (
            <div key={date} data-day={date} className="h-16 min-w-12 flex-1 p-0.5">
              <div className={cn('flex size-full flex-col items-center justify-center gap-0.5 rounded-xl', HATCH)}>
                <span aria-hidden className="rounded bg-card px-1 text-[13px] leading-4 font-medium text-muted-foreground">
                  {weekdayOf(date).short}
                </span>
                <span aria-hidden className="grid h-[34px] min-w-8 place-items-center rounded-full bg-card px-1 font-display text-[22px] leading-none text-muted-foreground">
                  {dayOfMonth(date)}
                </span>
                <span className="sr-only">{`${weekdayOf(date).name} ${dayOfMonth(date)}, ${BEYOND_RANGE}`}</span>
              </div>
            </div>
          );
        }
        return (
          <Button
            key={date}
            variant="quiet"
            data-day={date}
            aria-label={dayChipName(date, today)}
            aria-pressed={date === picked}
            aria-current={isToday ? 'date' : undefined}
            onClick={() => onPick(date)}
            className={cn(TOUCHING, 'h-16 min-w-12 flex-1')}
          >
            <span className={cn(FACE, 'flex-col gap-0.5')}>
              <span aria-hidden className={cn('text-[13px] leading-4', isToday ? 'font-semibold text-foreground' : 'font-medium')}>
                {isToday ? 'Today' : weekdayOf(date).short}
              </span>
              {isToday ? (
                <span aria-hidden className="grid size-[34px] place-items-center rounded-full bg-primary font-display text-xl leading-none text-primary-foreground">
                  {dayOfMonth(date)}
                </span>
              ) : (
                <span aria-hidden className="flex h-[34px] items-center font-display text-[22px] leading-none text-foreground">
                  {dayOfMonth(date)}
                </span>
              )}
            </span>
          </Button>
        );
      })}
    </SideScroll>
  );
}

// ---- A control of a few ------------------------------------------------------------------------

// Day, Week and Month; Morning, Afternoon, Evening and Whole day: a 52 tall --muted track (2 px of padding) of buttons 48 tall that
// touch, the choice pressed and in the Selected look, drawn inside its button. Each button is as wide as its word (flex-auto, the word at 15
// on one line, never cut), the buttons sharing what is left, so "Whole day" and "Afternoon" fit their buttons at 360 px. Below 360 px the buttons may
// shrink (min-w-0) and the words wrap, at 18 px a line so two lines still sit inside the 48 px button, rather than push the page sideways. Named by `label`, as a group.
export function Segmented<Value extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: Value; label: string }[];
  value: Value;
  onChange: (value: Value) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex h-13 rounded-2xl bg-muted p-0.5">
      {options.map((option) => (
        <Button key={option.value} variant="quiet" aria-pressed={option.value === value} onClick={() => onChange(option.value)} className={cn(TOUCHING, 'h-12 min-w-0 flex-auto')}>
          <span className={cn(FACE, 'px-1 text-center text-[15px] leading-5 whitespace-nowrap max-[359px]:leading-[18px] max-[359px]:whitespace-normal')}>{option.label}</span>
        </Button>
      ))}
    </div>
  );
}

// ---- The pager ---------------------------------------------------------------------------------

// A 48 tall row: a 48 px round Previous, the period's words in Young Serif 22 between them (a heading, so a screen reader finds
// it), a 48 px round Next. The caller names the two buttons for what they move by ("Previous week") and passes null for one that
// has nowhere to go, which is switched off. With `headingRef` the heading can take the focus (not by Tab), so a screen can put it
// there after a page is turned that switched off the button that was pressed.
export function Pager({
  words,
  headingRef,
  previousLabel,
  nextLabel,
  onPrevious,
  onNext,
}: {
  words: string;
  previousLabel: string;
  nextLabel: string;
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
  // For a screen that puts focus on the words after paging, when the button that was pressed has nowhere to go: the heading then takes
  // focus by script (tabIndex -1), not by Tab.
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <div className="flex min-h-12 items-center gap-2">
      <Button aria-label={previousLabel} disabled={!onPrevious} onClick={onPrevious ?? undefined} className="size-12 rounded-full bg-card p-0">
        <ChevronLeft aria-hidden className="size-6" />
      </Button>
      <h2 ref={headingRef} tabIndex={headingRef ? -1 : undefined} className={cn('min-w-0 flex-1 text-center font-display text-[22px] leading-7 wrap-anywhere', headingRef && 'outline-none')}>
        {words}
      </h2>
      <Button aria-label={nextLabel} disabled={!onNext} onClick={onNext ?? undefined} className="size-12 rounded-full bg-card p-0">
        <ChevronRight aria-hidden className="size-6" />
      </Button>
    </div>
  );
}

// ---- A row that scrolls sideways ---------------------------------------------------------------

// The people, the days or the lists in one line that the finger moves: no scroll bar and no "More" button, because the item cut at
// the edge is the sign. Its items keep their natural width (they do not shrink), each a real button reached by Tab, and the
// browser brings a focused one into view; the row has 4 px above and below, so the focus ring of an item is not cut by it. There is no swipe handler: the browser's own scrolling is the gesture. Named by `label`. `gap` is the space
// between the items, 8 px unless a row says otherwise (the day chips touch).
export function SideScroll({ label, children, className, gap = 'gap-2' }: { label: string; children: ReactNode; className?: string; gap?: string }) {
  return (
    <div role="group" aria-label={label} className={cn('flex', gap, 'overflow-x-auto overscroll-x-contain py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0', className)}>
      {children}
    </div>
  );
}

// ---- A card ------------------------------------------------------------------------------------

// One card of the column: --card, 22 round, 12 inside and its children 8 apart. With a `label` it is a named region.
export function PhoneCard({ label, children, className }: { label?: string; children: ReactNode; className?: string }) {
  const look = cn('flex flex-col gap-2 rounded-[22px] bg-card p-3', className);
  return label ? (
    <section aria-label={label} className={look}>
      {children}
    </section>
  ) : (
    <div className={look}>{children}</div>
  );
}
