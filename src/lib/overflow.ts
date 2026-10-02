// Where the Wall scrolls, it says so (docs/look.md, The parts, Overflow). A tablet in a kiosk browser draws no scrollbars, so a
// row or a column that holds more than it shows needs a button that says there is more, moves it on, and at its end takes it
// back. What that button does is decided here, from measurements, and so is tested without a screen (tests/overflow.test.ts):
// whether the box overflows, whether it is at its end, and where one press takes it. Measuring is use-overflow.ts's.

export type Axis = 'x' | 'y';

// A scrolling box as the browser measures it, along its one axis: what its contents need (scrollWidth or scrollHeight), what it
// shows (clientWidth or clientHeight), how far it is scrolled (scrollLeft or scrollTop), and `buttonSize`, what the button
// holds back while it is shown: 0 while it is not, or when it sits somewhere that takes nothing from the box.
//
// A button takes room in one of two ways. Beside the box (the people strip's) it takes room from the box, which is smaller by it
// while the button is shown: `clientSize` is what the box shows now, and `buttonSize` is the button and the gap to it. Over the
// end of the box (`over`, a column's foot) it is the last thing the box holds, which is therefore longer by it while the button
// is shown, and it covers the end of what the box shows. Either way the button is held to the room the box has without it, so
// drawing the button never decides whether it is needed, and it does not come and go.
export type Scroll = { scrollSize: number; clientSize: number; scrollOffset: number; buttonSize: number; over?: boolean };

// `next` is where a press takes the box: on by most of a page, but never past the end (and all the way to it when only a sliver
// would be left, rather than a press for a few pixels), and from the end back to the start.
export type OverflowState = { overflowing: boolean; atEnd: boolean; next: number };

// The browser reports sizes in whole pixels, so a box that holds 0.4 px more than it shows reports 1 px more. One pixel is not
// something to scroll to, and not a reason to draw a button.
const SLACK_PX = 1;

// "Most of a page": one press moves a box on by this much of what it shows, so that what was last in view is still in view.
export const PAGE_STEP = 0.8;

// ponytail: right-to-left offsets (scrollLeft is negative there) and a box shorter than its foot do not exist on the Wall; not handled.
export function overflowState({ scrollSize, clientSize, scrollOffset, buttonSize, over = false }: Scroll): OverflowState {
  const farthest = scrollSize - clientSize;
  const atEnd = scrollOffset >= farthest - SLACK_PX;
  // A button over the end of the box covers some of it, so a page is what it leaves clear: a press never moves on by more than
  // that, and nothing slips under the button between one press and the next. At least one pixel, so a box too short for its
  // button still moves on.
  const page = clientSize - (over ? buttonSize : 0);
  const target = scrollOffset + Math.max(PAGE_STEP * page, 1);
  // A press keeps the rest of a page in view (the fifth it does not move by). When no more than that would be left beyond where it
  // lands, one more press would move the box by less than that: this one goes to the end.
  const sliver = farthest - target < Math.max((1 - PAGE_STEP) * page, 0);
  // A foot over the box's end never changes what the box shows and adds exactly its own height to what the box holds, so the same box
  // measures the same with it and without it: overflow is tested plainly, and the foot goes the moment the list fits.
  //
  // A button beside the box takes room from it, and a button once drawn (`buttonSize` is more than 0) stays until the box clearly
  // fits, by the pixel of slack the other way. A button 136.7 px wide is reported as 137 and the room it leaves as 662 when it is
  // 661.7, so the same box measured without the button and with it can differ by a pixel; a box that the one measure asks a button for
  // and the other does not would draw it, lose it and draw it for ever. Asked for at more than the slack over, kept at more than the
  // slack under: one answer always stands.
  const overflowing = over ? scrollSize - buttonSize > clientSize + SLACK_PX : scrollSize > clientSize + buttonSize + (buttonSize > 0 ? -SLACK_PX : SLACK_PX);
  return { overflowing, atEnd, next: atEnd ? 0 : sliver ? farthest : target };
}

// A press is taken only when the scroll the last one began has ended. A smooth scroll takes most of a second, and a second press that
// reads the box in the middle of it takes it from where it is and not from where it is going: "Back" pressed twice, 60 ms apart, left the
// box at its end (the second read the offset in the middle, and the rule above sent it on). The gate is told when the scroll has
// ended (`end`: scrollend, or a scroll that has stopped coming in a browser with none); `take` is given the clock, so that it needs none.
// A scroll that is never heard to end (a press that moved nothing, a browser that says nothing) is let go of after PRESS_HOLD_MS, longer
// than any scroll the Wall starts, so the button is never left dead.
export const PRESS_HOLD_MS = 1000;

export type PressGate = { take: (now: number) => boolean; end: () => void };

export function createPressGate(holdMs: number = PRESS_HOLD_MS): PressGate {
  let busyUntil = -Infinity;
  return {
    take(now) {
      if (now < busyUntil) return false;
      busyUntil = now + holdMs;
      return true;
    },
    end() {
      busyUntil = -Infinity;
    },
  };
}

// What the button says and is called. A row's "More" names what is in the row ("More people"); a column's names whose it is
// ("More of Ava's routines"), since the word alone would not say which of several columns it moves. The visible word is always
// in the name, so a name spoken from the screen finds it. At the end the button reads "Back" and returns to the start.
export type Words = { text: string; name: string };

export function overflowWords(axis: Axis, of: string): { more: Words; back: Words } {
  return axis === 'x'
    ? { more: { text: `More ${of}`, name: `More ${of}` }, back: { text: 'Back', name: `Back to the first ${of}` } }
    : { more: { text: 'More', name: `More of ${of}` }, back: { text: 'Back', name: `Back to the top of ${of}` } };
}
