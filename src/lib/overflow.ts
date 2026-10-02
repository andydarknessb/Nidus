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

// `next` is where a press takes the box: on by most of a page, but never past the end, and from the end back to the start.
export type OverflowState = { overflowing: boolean; atEnd: boolean; next: number };

// The browser reports sizes in whole pixels, so a box that holds 0.4 px more than it shows reports 1 px more. One pixel is not
// something to scroll to, and not a reason to draw a button.
const SLACK_PX = 1;

// "Most of a page": one press moves a box on by this much of what it shows, so that what was last in view is still in view.
export const PAGE_STEP = 0.8;

export function overflowState({ scrollSize, clientSize, scrollOffset, buttonSize, over = false }: Scroll): OverflowState {
  const farthest = scrollSize - clientSize;
  const atEnd = scrollOffset >= farthest - SLACK_PX;
  // A button over the end of the box covers some of it, so a page is what it leaves clear: a press never moves on by more than
  // that, and nothing slips under the button between one press and the next. At least one pixel, so a box too short for its
  // button still moves on.
  const page = clientSize - (over ? buttonSize : 0);
  return {
    overflowing: scrollSize > clientSize + buttonSize + SLACK_PX,
    atEnd,
    next: atEnd ? 0 : Math.min(scrollOffset + Math.max(PAGE_STEP * page, 1), farthest),
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
