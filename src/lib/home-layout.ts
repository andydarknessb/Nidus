import { useSyncExternalStore } from 'react';

// What Home holds at the screen's size. The 1280 x 800 Wall holds five day columns and three Up next tiles; the navigation rail
// and the right rail are fixed, so below 1200 px wide the day columns share too little room and Home shows four days, and below
// 760 px tall the three tiles (336 px) leave the list card under them no row and Up next shows two.
// Those are widths and heights at the Wall's 16 px text. Larger text (a root font size above 16 px, from the tablet's font size
// setting) makes every rem box bigger and leaves the screen as it is, so the same boxes have the room of a smaller screen: what
// the screen holds is judged in rem, as the screen would be at 16 px (`rem` is the root font size, 16 where it is not known).
// The Wall is never shorter than WALL_MIN_REM (WallPage.tsx): a screen shorter than that scrolls, so the room it has is that much.
// `phone` is the Wall laid out for a phone (docs/specs/0004): below 768 px wide, by the width alone, never by the height, the
// device, the user agent or the text size. A width of 0 (a window that has not been laid out yet) is not a phone. At 768 px and
// wider nothing about the Wall changes at 16 px text.
// `portrait` is a tablet hung upright (docs/specs/0009): at 768 px and wider, a viewport taller than it is wide, by the viewport
// alone. A phone is never portrait, whatever its height; a square viewport is landscape; a width of 0 is neither.
export type HomeLayout = { days: 5 | 4 | 3; tiles: 3 | 2 | 1; phone: boolean; portrait: boolean };

// The least width of a tablet: below it the Wall is a phone.
const PHONE_BELOW = 768;

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
  const phone = width > 0 && width < PHONE_BELOW;
  return { days, tiles: tall < 760 ? (rem > 16 && tall < ONE_TILE_BELOW ? 1 : 2) : 3, phone, portrait: !phone && width > 0 && height > width };
}

// Home's grid: the days and the rail side by side, or in portrait the days over the rail, which takes the height Up next needs.
export const homeGrid = (portrait: boolean) =>
  portrait
    ? 'grid min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto] gap-4'
    : 'grid min-h-0 grid-cols-[minmax(0,1fr)_min(20rem,max(320px,27vw))] gap-4';

function subscribe(onChange: () => void) {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
}

// The root font size now, 16 where the browser gives none (and on the server, where a test draws markup).
export function rootFontSize(): number {
  return typeof document === 'undefined' ? 16 : parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

// Home's layout at the window's size now, drawn again when the window is resized. Each part is read on its own, so a resize that
// changes none of them is no render. A change of the text size reloads the page on the tablet, so the root font size is read
// with the size and needs no listener of its own.
export function useHomeLayout(): HomeLayout {
  const size = () => homeLayout({ width: window.innerWidth, height: window.innerHeight, rem: rootFontSize() });
  return {
    days: useSyncExternalStore(subscribe, () => size().days),
    tiles: useSyncExternalStore(subscribe, () => size().tiles),
    phone: useSyncExternalStore(subscribe, () => size().phone),
    portrait: useSyncExternalStore(subscribe, () => size().portrait),
  };
}
