import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { holdEndsAt, type Holds } from './hold';

// The two hooks Home's cards share (hold.ts has the rule). Neither is tested: there is no DOM test library, and each is written once.

// The time a card last looked at, renewed when the first of its holds ends, and not before: the card draws again then, and a row whose
// hold has ended goes. A tap does not move it (a tap later than `now` is held), so the timer is the only thing that does. The timer
// is cleared when a hold is added or taken back, and with the card.
export function useHoldClock(holds: Holds): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const ends = holdEndsAt(holds, now);
    if (ends === null) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(ends - Date.now(), 0));
    return () => clearTimeout(timer);
  }, [holds, now]);
  return now;
}

// A row that goes while it has the keyboard's focus would leave the keyboard nowhere, so the focus goes to the link in the card's
// heading. Returns the ref a row is drawn with: it is called with null as the row goes, while its button is still on the page and still
// has the focus, so what is noted there is read once the page has changed.
export function useFocusToLink(card: RefObject<HTMLElement | null>, link: RefObject<HTMLElement | null>): (row: HTMLElement | null) => void {
  const focusLost = useRef(false);
  const watchRow = useCallback(
    (row: HTMLElement | null) => {
      if (row === null && card.current?.contains(document.activeElement)) focusLost.current = true;
    },
    [card],
  );
  useEffect(() => {
    if (!focusLost.current) return;
    focusLost.current = false;
    if (!document.activeElement || document.activeElement === document.body) link.current?.focus();
  });
  return watchRow;
}
