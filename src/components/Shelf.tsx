import { cn } from 'cn';
import type { ReactNode } from 'react';
import { useOverflow } from '../lib/use-overflow';
import { BODY_CLEARANCE, OverflowButton } from './OverflowButton';

// The shelf (spec 0014): the screen that holds a row of columns or cards, and on a tablet hung upright a grid of them. It owns the
// heading row and where More sits in it, the sideways row, the portrait grid, the shared More foot, and the wrapper that keeps a
// column mounted when the tablet turns. The title and the row's own controls stay the screen's, as slots, so a title's id and its
// focus-on-arrival are the screen's own. `between` is what a screen puts between the row and the shelf (the read's ladder, its empty
// words): the chart and the Lists screen both put theirs there.

export function Shelf({
  title,
  controls,
  between,
  of,
  footOf = of,
  portrait,
  items,
  rowClassName,
  gridClassName,
}: {
  // The screen's own heading element: its id and ref are the screen's.
  title: ReactNode;
  // The row's other controls, before More.
  controls?: ReactNode;
  // The read's ladder and the screen's empty words, between the heading row and the shelf.
  between?: ReactNode;
  // The noun the heading row's More counts ("people", "lists").
  of: string;
  // The noun the portrait foot counts, when it is not the same one ("the routines", "the lists").
  footOf?: string;
  portrait: boolean;
  items: ReactNode[];
  // The sideways row's own classes (a card's width, snap, its gap), and the portrait grid's gap.
  rowClassName?: string;
  gridClassName?: string;
}) {
  const row = useOverflow(portrait ? 'y' : 'x', portrait ? 'over' : undefined);
  return (
    <>
      <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {title}
        <div className="flex max-w-full flex-none flex-wrap items-center gap-x-4 gap-y-2">
          {controls}
          {!portrait && <OverflowButton control={row} of={of} className="h-12" />}
        </div>
      </div>
      {between}
      {portrait ? (
        <div ref={row.scroller} className="min-h-0 flex-1 overflow-y-auto">
          <div className={cn('grid grid-cols-[repeat(auto-fit,minmax(min(17rem,100%),1fr))] items-start', gridClassName ?? 'gap-x-3 gap-y-4', BODY_CLEARANCE)}>{items}</div>
          <OverflowButton control={row} of={footOf} />
        </div>
      ) : (
        <div ref={row.scroller} className={rowClassName ?? 'flex min-h-0 flex-1 items-start gap-3 overflow-x-auto'}>
          {/* The same wrapper as portrait's, so turning the tablet keeps each column (and its read) instead of mounting it again. */}
          <div className="contents">{items}</div>
        </div>
      )}
    </>
  );
}
