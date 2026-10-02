import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPressGate, overflowState, type Axis, type Scroll } from './overflow';

// Does this scrolling box hold more than it shows, is it at its end, and move it on one step. The rule is overflowState's
// (src/lib/overflow.ts); this measures a box and acts on it. A tablet in a kiosk browser draws no scrollbars, so the box is
// given a button (OverflowButton) that says there is more.
//
// `fit` is where the button sits, when it takes room from the box: `beside` it, in the row the box is in (the people strip's),
// or `over` its end (a column's foot, the last thing the box holds). A button anywhere else, such as in a screen's heading row,
// takes nothing from the box, and `fit` is left out.
export type Fit = 'beside' | 'over';

// What a screen is handed: the box's ref and the button's (`piece`: the button itself, or the foot that holds it), for
// OverflowButton to place, and what the box says.
export type OverflowControl = {
  axis: Axis;
  overflowing: boolean;
  atEnd: boolean;
  scroller: (element: HTMLElement | null) => void | (() => void);
  piece: (element: HTMLElement | null) => void;
  step: () => void;
};

// What a box says when there is no box, or before it has been measured: nothing to scroll.
const NOTHING = { overflowing: false, atEnd: false };

// In a browser with no scrollend, a scroll has ended when no more of it has come for this long (a smooth scroll comes every frame).
const SCROLL_STOPPED_MS = 100;

export function useOverflow(axis: Axis, fit?: Fit): OverflowControl {
  const box = useRef<HTMLElement | null>(null);
  const piece = useRef<HTMLElement | null>(null);
  const [state, setState] = useState(NOTHING);
  // Takes a press only when the scroll the last one began has ended (createPressGate).
  const [gate] = useState(createPressGate);
  const sideways = axis === 'x';

  // What the browser says about the box now, and what the button holds back while it is drawn: its size, and beside the box the gap
  // the row puts between them, which is room too. A foot is measured exactly, not rounded: a root font size can make it a fraction
  // of a pixel tall, and the rule (overflowState) relies on knowing exactly what it added to the list.
  const read = useCallback((): Scroll | null => {
    const element = box.current;
    if (!element) return null;
    const button = piece.current;
    let buttonSize = 0;
    if (fit && button) {
      const exact = button.getBoundingClientRect();
      buttonSize = fit === 'over' ? (sideways ? exact.width : exact.height) : sideways ? button.offsetWidth : button.offsetHeight;
      if (fit === 'beside' && button.parentElement) {
        const row = getComputedStyle(button.parentElement);
        buttonSize += parseFloat(sideways ? row.columnGap : row.rowGap) || 0;
      }
    }
    return {
      scrollSize: sideways ? element.scrollWidth : element.scrollHeight,
      clientSize: sideways ? element.clientWidth : element.clientHeight,
      scrollOffset: sideways ? element.scrollLeft : element.scrollTop,
      buttonSize,
      over: fit === 'over',
    };
  }, [sideways, fit]);

  // Whether the box overflowed at the last read.
  const was = useRef(false);

  const measure = useCallback(() => {
    const scroll = read();
    if (!scroll) return;
    const { overflowing, atEnd } = overflowState(scroll);
    // A box that stops overflowing (a list whose crossed off items were cleared, until it fits) is put back at its start: left
    // where it was scrolled to, it would hide what is first.
    if (was.current && !overflowing) box.current?.scrollTo(sideways ? { left: 0 } : { top: 0 });
    was.current = overflowing;
    // The same answer is the same state, so a read that found nothing new is not a render.
    setState((last) => (last.overflowing === overflowing && last.atEnd === atEnd ? last : { overflowing, atEnd }));
  }, [read, sideways]);

  // Chrome gives the keyboard's focus to an element that is only partly in view without scrolling to it, so Tab could land on a pill
  // with 16 px of it showing. What takes the keyboard's focus in the box is brought fully into view (a touch or a click is left
  // alone: it would move what a finger is on).
  const reveal = useCallback((event: FocusEvent) => {
    if (event.target instanceof HTMLElement && event.target.matches(':focus-visible')) event.target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, []);

  // The box is watched for its size, for being scrolled (and for the scroll ending) and for the fonts: a font that arrives changes how
  // words wrap, and so how much the box holds. A callback ref, so that a box that arrives after the first render (a column with
  // nothing to show has none) is watched from the moment it does.
  const scroller = useCallback(
    (element: HTMLElement | null) => {
      if (!element) return;
      box.current = element;
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      // A scroll has ended when the browser says so (scrollend), or, in one that does not, when no more has come for a moment.
      const hasScrollEnd = 'onscrollend' in element;
      let stopped: ReturnType<typeof setTimeout> | undefined;
      const scrolled = () => {
        measure();
        if (hasScrollEnd) return;
        clearTimeout(stopped);
        stopped = setTimeout(gate.end, SCROLL_STOPPED_MS);
      };
      element.addEventListener('scroll', scrolled, { passive: true });
      if (hasScrollEnd) element.addEventListener('scrollend', gate.end);
      element.addEventListener('focusin', reveal);
      let live = true;
      void document.fonts.ready.then(() => live && measure());
      document.fonts.addEventListener('loadingdone', measure);
      return () => {
        live = false;
        observer.disconnect();
        clearTimeout(stopped);
        element.removeEventListener('scroll', scrolled);
        element.removeEventListener('scrollend', gate.end);
        element.removeEventListener('focusin', reveal);
        document.fonts.removeEventListener('loadingdone', measure);
        box.current = null;
        // A box that goes (a list with its last item cleared) has nothing to scroll, so a new one does not start as the old one ended.
        was.current = false;
        setState(NOTHING);
      };
    },
    [measure, reveal, gate],
  );
  const holder = useCallback((element: HTMLElement | null) => {
    piece.current = element;
  }, []);
  // A person, a tile or an item coming or going is a render, not a resize of the box.
  useLayoutEffect(measure);

  // One press, on what the box is now: on by most of a page, or from the end back to the start. Not smoothly for someone who
  // asked for less motion. A press while the last one's scroll is still running is ignored (createPressGate).
  const step = useCallback(() => {
    const scroll = read();
    if (!box.current || !scroll || !gate.take(performance.now())) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const { next } = overflowState(scroll);
    box.current.scrollTo(sideways ? { left: next, behavior: reduced ? 'auto' : 'smooth' } : { top: next, behavior: reduced ? 'auto' : 'smooth' });
    // An instant scroll, or one that goes nowhere, has nothing to wait for.
    if (reduced || Math.abs(next - scroll.scrollOffset) < 1) gate.end();
  }, [read, sideways, gate]);

  return { axis, overflowing: state.overflowing, atEnd: state.atEnd, scroller, piece: holder, step };
}
