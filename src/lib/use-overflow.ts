import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { overflowState, type Axis, type Scroll } from './overflow';

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

export function useOverflow(axis: Axis, fit?: Fit): OverflowControl {
  const box = useRef<HTMLElement | null>(null);
  const piece = useRef<HTMLElement | null>(null);
  const [state, setState] = useState({ overflowing: false, atEnd: false });
  const sideways = axis === 'x';

  // What the browser says about the box now, and what the button holds back while it is drawn: its size, and beside the box
  // the gap the row puts between them, which is room too.
  const read = useCallback((): Scroll | null => {
    const element = box.current;
    if (!element) return null;
    let buttonSize = 0;
    if (fit && piece.current) {
      buttonSize = sideways ? piece.current.offsetWidth : piece.current.offsetHeight;
      if (fit === 'beside' && element.parentElement) {
        const gap = getComputedStyle(element.parentElement);
        buttonSize += parseFloat(sideways ? gap.columnGap : gap.rowGap) || 0;
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

  const measure = useCallback(() => {
    const scroll = read();
    if (!scroll) return;
    const { overflowing, atEnd } = overflowState(scroll);
    // The same answer is the same state, so a read that found nothing new is not a render.
    setState((last) => (last.overflowing === overflowing && last.atEnd === atEnd ? last : { overflowing, atEnd }));
  }, [read]);

  // The box is watched for its size, for being scrolled and for the fonts: a font that arrives changes how words wrap, and so
  // how much the box holds. A callback ref, so that a box that arrives after the first render (a column with nothing to show
  // has none) is watched from the moment it does.
  const scroller = useCallback(
    (element: HTMLElement | null) => {
      if (!element) return;
      box.current = element;
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      element.addEventListener('scroll', measure, { passive: true });
      let live = true;
      void document.fonts.ready.then(() => live && measure());
      document.fonts.addEventListener('loadingdone', measure);
      return () => {
        live = false;
        observer.disconnect();
        element.removeEventListener('scroll', measure);
        document.fonts.removeEventListener('loadingdone', measure);
        box.current = null;
      };
    },
    [measure],
  );
  const holder = useCallback((element: HTMLElement | null) => {
    piece.current = element;
  }, []);
  // A person, a tile or an item coming or going is a render, not a resize of the box.
  useLayoutEffect(measure);

  // One press, on what the box is now: on by most of a page, or from the end back to the start. Not smoothly for someone who
  // asked for less motion.
  const step = useCallback(() => {
    const scroll = read();
    if (!box.current || !scroll) return;
    const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    const { next } = overflowState(scroll);
    box.current.scrollTo(sideways ? { left: next, behavior } : { top: next, behavior });
  }, [read, sideways]);

  return { axis, overflowing: state.overflowing, atEnd: state.atEnd, scroller, piece: holder, step };
}
