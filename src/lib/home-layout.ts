import { useLayoutEffect, useSyncExternalStore } from 'react';

// What Home holds at the screen's size. The 1280 x 800 Wall holds five day columns and three Up next tiles; the navigation rail
// and the right rail are fixed, so below 1200 px wide the day columns share too little room and Home shows four days, and below
// 760 px tall the three tiles (336 px) leave the list card under them no row and Up next shows two. In portrait Up next shows as many
// tiles as a third of the height holds, never fewer than the landscape rule gives: a row of n tiles is 72 + 88n px at 16 px text, so 6
// at 1920 tall, 5 at 1732, 4 at 1472, 3 at 1024 (#190).
// Those are widths and heights at the Wall's 16 px text. Larger text (a root font size above 16 px, from the tablet's font size
// setting) makes every rem box bigger and leaves the screen as it is, so the same boxes have the room of a smaller screen: what
// the screen holds is judged in rem, as the screen would be at 16 px (`rem` is the root font size, 16 where it is not known).
// The Wall is never shorter than WALL_MIN_REM (WallPage.tsx): a screen shorter than that scrolls, so the room it has is that much.
// `phone` is the Wall laid out for a phone (docs/specs/0004): below 768 px wide, or on its side (a viewport shorter than the Wall's
// least height, 544 px, which no tablet of the Wall's kind is and every phone turned sideways is; spec 0004's follow-up, #176), by
// the viewport alone, never the device, the user agent or the text size. A width of 0 (a window that has not been laid out yet) is
// not a phone. At 768 px and wider nothing about the Wall changes at 16 px text, except that a viewport taller than it is wide is
// `portrait` (below). The phone's styles follow the document's `data-phone` (the `phone:` variant, index.css), which useHomeLayout
// sets from this one rule, so the keyboard hold (below) holds them too.
// `portrait` is a tablet hung upright (docs/specs/0009): at 768 px and wider, a viewport taller than it is wide, by the viewport
// alone. A phone is never portrait, whatever its height; a square viewport is landscape; a width of 0 is neither.
export type HomeLayout = { days: 5 | 4 | 3; tiles: number; phone: boolean; portrait: boolean };

// The least width of a tablet: below it the Wall is a phone.
const PHONE_BELOW = 768;
// The least height of a tablet, the Wall's least height at 16 px text (WALL_MIN_REM): below it the Wall is a phone on its side.
const PHONE_SHORTER_THAN = 544;

// The least height of the Wall, in rem: 544 px at 16 px text, which the shortest tablet of the Wall's kind (1024 x 600) clears.
// Below it the Wall is this tall and the page scrolls. It is the same number as the `min-h-[34rem]` on the Wall's shell.
export const WALL_MIN_REM = 34;

// Larger text, on a screen that has the room of one under 800 px at 16 px text, holds three days: four columns would each be left less
// than 140 px, which the time of a pill ("11:00 AM") is wider than. (At 16 px text a narrow tablet keeps the four it always had.)
const THREE_DAYS_BELOW = 800;

// Larger text, on a screen with the room of one under 560 px tall at 16 px text, holds one Up next tile: two tiles and the list card's field
// to add an item need more than the screen has, so the list card would be left with no row.
const ONE_TILE_BELOW = 560;

export function homeLayout({ width, height, rem = 16 }: { width: number; height: number; rem?: number }): HomeLayout {
  const scale = 16 / rem;
  const room = width * scale;
  const days = room >= 1200 ? 5 : rem > 16 && room < THREE_DAYS_BELOW ? 3 : 4;
  const tall = Math.max(height, WALL_MIN_REM * rem) * scale;
  const phone = width > 0 && (width < PHONE_BELOW || (height > 0 && height < PHONE_SHORTER_THAN));
  const portrait = !phone && width > 0 && height > width;
  const landscapeTiles = tall < 760 ? (rem > 16 && tall < ONE_TILE_BELOW ? 1 : 2) : 3;
  const tiles = portrait ? Math.max(landscapeTiles, Math.floor((tall / 3 - 72) / 88)) : landscapeTiles;
  return { days, tiles, phone, portrait };
}

// Home's grid: the days and the rail side by side, or in portrait the days over the rail, which takes the height Up next needs but
// never less than three tiles' worth: 21 rem is Up next's card with three tiles (24 padding + 48 heading + 8 gap + 3 x 80 tiles + 2 x 8 gaps =
// 336 px, UpNext.tsx), so the Pinned List's card keeps its rows and the calendar does not jump when tiles come and go. In portrait Up next's
// tiles follow the height (above), so the row is as tall as they need: 4.5 + 5.5n rem for n tiles.
export const homeGrid = (portrait: boolean) =>
  portrait
    ? 'grid min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_minmax(21rem,auto)] gap-4'
    : 'grid min-h-0 grid-cols-[minmax(0,1fr)_min(20rem,max(320px,27vw))] gap-4';

// The keyboard hold. An Android keyboard shrinks the viewport, and on a portrait tablet (920 by 1472) a 600 px keyboard makes it wider
// than tall, so the layout would flip to landscape under the field being typed in. So the Wall remembers `room`, the viewport last read
// with no keyboard. A read that finds the same width and a smaller height, while a field has the focus or for half a second after one
// lost it (the keyboard is still going down when a tap on a button blurs the field), is the keyboard, and the layout stays the room's.
// Any other read (another width, a height that is not smaller, no field in play) is a new room. A field that keeps the focus after the
// keyboard is hidden (Android's back button) holds nothing: the viewport grows, which is not smaller, so it is a new room.
export type Viewport = { width: number; height: number };
const KEYBOARD_MS = 500;
const FIELD = 'input, textarea, select, [contenteditable]';

// The size to lay the Wall out at: the room when this is the keyboard, else the viewport now.
export function viewportToLayOut({
  width,
  height,
  room,
  keyboardMayBeUp,
}: Viewport & { room: Viewport | null; keyboardMayBeUp: boolean }): Viewport {
  return keyboardMayBeUp && room && room.width === width && height < room.height ? room : { width, height };
}

let room: Viewport | null = null;
let fieldLeftAt = -Infinity;

// A resize reads the layout again, and so does leaving a field, once the keyboard has had time to go (the layout catches up).
function subscribe(onChange: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onFocusOut = (e: FocusEvent) => {
    if (!(e.target instanceof Element && e.target.matches(FIELD))) return;
    fieldLeftAt = Date.now();
    clearTimeout(timer);
    timer = setTimeout(onChange, KEYBOARD_MS + 50);
  };
  window.addEventListener('resize', onChange);
  window.addEventListener('focusout', onFocusOut);
  return () => {
    clearTimeout(timer);
    window.removeEventListener('resize', onChange);
    window.removeEventListener('focusout', onFocusOut);
  };
}

// The root font size now, 16 where the browser gives none (and on the server, where a test draws markup).
export function rootFontSize(): number {
  return typeof document === 'undefined' ? 16 : parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

const typing = () => document.activeElement?.matches(FIELD) ?? false;

// Home's layout at the window's size now, drawn again when the window is resized or a field is left, and held at the room's size while
// the keyboard may be up (above). Each part is read on its own, so a resize that changes none of them is no render. A change of the text
// size reloads the page on the tablet, so the root font size is read with the size and needs no listener of its own.
export function useHomeLayout(): HomeLayout {
  const read = () => {
    const keyboardMayBeUp = typing() || Date.now() - fieldLeftAt < KEYBOARD_MS;
    room = viewportToLayOut({ width: window.innerWidth, height: window.innerHeight, room, keyboardMayBeUp });
    return homeLayout({ ...room, rem: rootFontSize() });
  };
  const phone = useSyncExternalStore(subscribe, () => read().phone);
  // A phone on its side: the room (never the keyboard's viewport) is under 544 px tall. `read` has set the room.
  const side = useSyncExternalStore(subscribe, () => read().phone && (room as Viewport).height < PHONE_SHORTER_THAN);
  // The document says when it is a phone, before the paint, so the phone's styles swap with the layout and never on a rule of their
  // own; "side" says it is on its side, so PhoneShell keeps the column's right clear of Add event, held through the keyboard like the rest.
  useLayoutEffect(() => {
    if (phone) document.documentElement.setAttribute('data-phone', side ? 'side' : '');
    else document.documentElement.removeAttribute('data-phone');
    return () => document.documentElement.removeAttribute('data-phone');
  }, [phone, side]);
  return {
    days: useSyncExternalStore(subscribe, () => read().days),
    tiles: useSyncExternalStore(subscribe, () => read().tiles),
    phone,
    portrait: useSyncExternalStore(subscribe, () => read().portrait),
  };
}
