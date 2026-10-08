import { useEffect, useRef, useState, type RefObject } from 'react';
import { focusIsLost, moveFocus } from './focus';
import { createPageFocus, limitWords, pagedView, type CalendarView, type LimitWords, type PagedView } from './paged-view';

// The paged view's hook (paged-view.ts has the rules): the page for the view and the date asked for, the words at the limit, and a ref
// for the page's title, which it moves focus to when the core says to. It only wires the core to the screen. A screen keys its contents on
// the anchor, so when a page turns, or moves by itself at Household midnight, whatever had focus in them is gone; the effect runs on the
// view, the date asked for and the anchor, and the core tells the two apart.
//
// `takesFocusOnArrival` is the Wall's (focus goes to the title when the screen opens or another view does). `preventScroll` is the phone's,
// whose page would jump to the title. StrictMode runs the effect twice; the core is kept in state, so the second run sees what the first did.
export function usePagedView<V extends CalendarView>({
  view,
  date,
  now,
  timezone,
  limits,
  takesFocusOnArrival,
  preventScroll = false,
}: {
  view: V;
  date: string | null;
  now: Date;
  timezone: string;
  limits: LimitWords;
  takesFocusOnArrival: boolean;
  preventScroll?: boolean;
}): PagedView<V> & { limit: string; heading: RefObject<HTMLHeadingElement | null> } {
  const page = pagedView(view, date, now, timezone);
  const heading = useRef<HTMLHeadingElement>(null);
  const [focus] = useState(() => createPageFocus({ takesFocusOnArrival }));
  const { anchor } = page;
  useEffect(() => {
    moveFocus(focus.after({ view, date, anchor }, focusIsLost()), heading.current, preventScroll ? { preventScroll: true } : undefined);
  }, [focus, view, date, anchor, preventScroll]);
  return { ...page, limit: limitWords(page, limits), heading };
}
