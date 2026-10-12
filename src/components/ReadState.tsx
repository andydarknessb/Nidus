import type { ReactNode } from 'react';
import { couldNotLoad, type ReadStateName } from '../lib/synced-read';
import { EmptyWords } from './EmptyWords';

// The read ladder (spec 0011): "Loading" while nothing has been read, the alert with "Could not load <of>. Check your connection."
// once the first read has failed, and the children once something has been read (a lost connection after that keeps what was read,
// and the header says so). The only place those words and the alert role are spelt; `of` is the thing read ("routines"), `read` is
// anything that says a `state` (a synced read, the Meal Plan, the Routines of today).
//
// A frame that must stay mounted while nothing is read (a scroller keeps its ref, a grid its cells) is drawn beside it, not inside.
// `say` draws only one rung, for a screen that puts the other elsewhere (the Meal Plan's "Loading" sits in a corner of its grid, its
// alert above it). `className` is where "Loading" sits; `alert` is the alert's own classes; `announce={false}` leaves the role off, for
// a list of days of which only the first says it.
export function ReadState({
  of,
  read,
  say,
  className,
  alert = 'text-base',
  announce = true,
  children,
}: {
  of: string;
  read: { state: ReadStateName };
  say?: 'loading' | 'failed';
  className?: string;
  alert?: string;
  announce?: boolean;
  children?: ReactNode;
}) {
  if (read.state === 'ready') return <>{children}</>;
  if (say !== undefined && say !== read.state) return null;
  return read.state === 'loading' ? (
    <EmptyWords className={className}>Loading</EmptyWords>
  ) : (
    <p role={announce ? 'alert' : undefined} className={alert}>
      {couldNotLoad(of)}
    </p>
  );
}
