import { cn } from 'cn';
import { Pin } from 'lucide-react';
import { Fragment, type Ref } from 'react';
import type { Occurrence, WallDay } from '../lib/calendar-occurrences';
import { HOUR_REM, hourWords, type DayBlock, type DayPlan, type FoldTile } from '../lib/day-view';
import type { Profile } from '../lib/profiles';
import { pillName, pillPeople, type Pill, type PillPeople } from '../lib/schedule';
import { EventDiscs, EventFill, EventPill } from './EventPill';
import { Button } from './ui/button';

// What the Day view draws (docs/look.md; spec 0003, Day view): the two rows above and below the hour grid, and the grid. All of it
// is drawn from what src/lib/day-view.ts has decided and none of it reads anything, so it is tested as markup.

// The "+N" of a crowded cluster is one 48 px target at the right of the second lane, 8 px from the block beside it.
const FOLD_WIDTH = '3rem';
const LANE_GAP_PX = 8;

// One of the Day view's two rows, exactly one pill tall whatever it holds: its word in the hour gutter's width, then the pills,
// 220 px wide each (a title takes one line), side by side and scrolling sideways when they do not fit. With none it says so in
// `empty` (nothing while the day is still being read, so an empty row is never claimed before it is known to be).
export function PillRow({
  ref,
  label,
  name,
  pills,
  day,
  people,
  empty,
  onOpen,
}: {
  ref?: Ref<HTMLDivElement>;
  label: string;
  name: string;
  pills: Pill[];
  day: WallDay;
  people: readonly Profile[];
  empty: string;
  onOpen: (occurrence: Occurrence) => void;
}) {
  return (
    <div ref={ref} role="group" aria-label={name} className="flex h-13 flex-none gap-2">
      <span aria-hidden className="flex w-15 flex-none items-center justify-end text-sm text-muted-foreground">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto overflow-y-hidden px-1.5 [scrollbar-width:none]">
        {pills.length === 0 ? (
          <p className="flex items-center text-sm text-muted-foreground">{empty}</p>
        ) : (
          pills.map((pill) => (
            <div key={pill.occurrence.id} className="w-[220px] flex-none">
              <EventPill pill={pill} day={day} people={pillPeople(pill.occurrence, people)} onOpen={onOpen} lines={1} className="py-1 focus-visible:-outline-offset-2" />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// The hours of the window: the gutter of labels, and the grid itself with a hairline at each hour, the now line behind the
// blocks, then the blocks and the "+N" of a crowded cluster. Every position is in rem, so an hour is 3 rem whatever the text
// size is. The now line and its dot are drawn first, so each block covers them and the line never crosses a title.
export function HourGrid({
  plan,
  day,
  people,
  onOpen,
  onFold,
}: {
  plan: DayPlan;
  day: WallDay;
  people: readonly Profile[];
  onOpen: (occurrence: Occurrence) => void;
  onFold: (fold: FoldTile) => void;
}) {
  const { startHour, endHour } = plan.window;
  const hours = Array.from({ length: endHour - startHour }, (_, index) => startHour + index);
  const at = (hour: number) => `${(hour - startHour) * HOUR_REM}rem`;
  return (
    <div className="flex flex-none gap-2" style={{ height: `${hours.length * HOUR_REM}rem` }}>
      <div aria-hidden className="relative w-15 flex-none text-sm leading-[18px] text-muted-foreground">
        {hours.map((hour, index) => (
          <span key={hour} className="absolute right-0" style={{ top: index === 0 ? 0 : `calc(${at(hour)} - 9px)` }}>
            {hourWords(hour)}
          </span>
        ))}
      </div>
      <div className="relative min-w-0 flex-1 rounded-[18px] bg-muted">
        {hours.slice(1).map((hour) => (
          <div key={hour} aria-hidden className="absolute inset-x-0 h-px bg-border" style={{ top: at(hour) }} />
        ))}
        {plan.nowHour !== null && (
          <>
            <div aria-hidden data-testid="now-line" className="pointer-events-none absolute inset-x-0 h-[3px] rounded-[2px] bg-foreground" style={{ top: at(plan.nowHour) }} />
            <div aria-hidden className="pointer-events-none absolute -left-[5px] size-[13px] rounded-full bg-foreground" style={{ top: `calc(${at(plan.nowHour)} - 5px)` }} />
          </>
        )}
        <div className="absolute inset-x-1.5 inset-y-0">
          {plan.blocks.map((block, index) => {
            // The "+N" of a cluster comes right after the last block of that cluster, so Tab reaches it from its own blocks.
            const fold = plan.blocks[index + 1]?.cluster === block.cluster ? undefined : plan.folds.find((each) => each.cluster === block.cluster);
            return (
              <Fragment key={block.pill.occurrence.id}>
                <EventBlock block={block} top={at(block.topHour)} day={day} people={pillPeople(block.pill.occurrence, people)} onOpen={onOpen} />
                {fold && <FoldButton fold={fold} top={at(fold.topHour)} onFold={onFold} />}
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// How tall the target of a block of `hours` hours is: exactly its hours, never under one hour (3 rem, 48 px). The target is not
// what is painted: the fill and the ring are drawn in a box that stops 2 px short of the target's bottom, so blocks that follow
// each other, whose 48 px targets touch, never read as one block. Side by side, blocks and the "+N" are 8 px apart.
const heightOf = (hours: number) => `max(${HOUR_REM}rem, ${hours * HOUR_REM}rem)`;
const PAINTED = 'pointer-events-none absolute inset-x-0 top-0 bottom-0.5 rounded-[14px]';

// One event in the grid: a flat fill in its people's colours with, on one line, the title (two lines when it is too long for one,
// then ending in an ellipsis; never broken inside a word), its time, "On now" when it is, and its discs at the right. The title
// gives way first: the time is never cut. A Native Event has the pin before its title. The one that is on now has the 2.5 px
// ring in --foreground, drawn over the fill. The fill and the ring stop 2 px short of the target (PAINTED), and the words are
// centred on the fill. The second lane of a lane pair starts 4 px past the middle, so the blocks are 8 px apart; one that
// leaves room for the "+N" is 8 px short of it.
function EventBlock({ block, top, day, people, onOpen }: { block: DayBlock; top: string; day: WallDay; people: PillPeople; onOpen: (occurrence: Occurrence) => void }) {
  const { pill } = block;
  const { occurrence } = pill;
  const half = LANE_GAP_PX / 2;
  return (
    <Button
      variant="quiet"
      aria-label={pillName(pill, day, people)}
      onClick={() => onOpen(occurrence)}
      className="absolute h-auto justify-start gap-3 rounded-[14px] px-0 pt-0 pr-2.5 pb-0.5 pl-3.5 text-left font-normal whitespace-normal text-foreground focus-visible:-outline-offset-2 active:bg-transparent"
      style={{
        top,
        height: heightOf(block.bottomHour - block.topHour),
        left: block.lane === 0 ? 0 : `calc(50% + ${half}px)`,
        width: block.lanes === 1 ? '100%' : block.narrow ? `calc(50% - ${half}px - ${FOLD_WIDTH} - ${LANE_GAP_PX}px)` : `calc(50% - ${half}px)`,
      }}
    >
      <span aria-hidden className={PAINTED}>
        <EventFill people={people} />
      </span>
      <span className="relative line-clamp-2 min-w-0 text-base leading-5 font-semibold text-ellipsis">
        {occurrence.source === 'native' && <Pin aria-hidden data-testid="native-mark" className="mr-1 inline size-3.5 align-[-2px]" />}
        {occurrence.title}
      </span>
      <span className="relative min-w-max flex-1 text-sm leading-[18px]">{pill.time}</span>
      {pill.onNow && <span className="relative shrink-0 text-sm leading-[18px] font-semibold">On now</span>}
      <span className="relative flex shrink-0">
        <EventDiscs people={people} />
      </span>
      {pill.onNow && <span aria-hidden className={cn(PAINTED, 'shadow-[inset_0_0_0_2.5px_var(--foreground)]')} />}
    </Button>
  );
}

// The "+N" of a cluster that needs more than two lanes, at the right end of the second lane: how many events are not drawn.
// It opens the list of the cluster. Its name starts with what is drawn on it ("+10 more, show the list"). A tile on the card with a ring in --input, never a colour of its own, drawn short of its
// target as a block is (PAINTED); pressed, the tile takes --accent.
function FoldButton({ fold, top, onFold }: { fold: FoldTile; top: string; onFold: (fold: FoldTile) => void }) {
  return (
    <Button
      variant="quiet"
      aria-label={`+${fold.folded} more, show the list`}
      onClick={() => onFold(fold)}
      className="group absolute right-0 h-auto rounded-[14px] px-0 pt-0 pb-0.5 text-[15px] text-foreground focus-visible:-outline-offset-2 active:bg-transparent"
      style={{ top, height: heightOf(fold.bottomHour - fold.topHour), width: FOLD_WIDTH }}
    >
      <span aria-hidden className={cn(PAINTED, 'bg-card shadow-[inset_0_0_0_1.5px_var(--input)] group-active:bg-accent')} />
      <span className="relative">{`+${fold.folded}`}</span>
    </Button>
  );
}
