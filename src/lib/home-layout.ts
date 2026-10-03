import { useSyncExternalStore } from 'react';

// What Home holds at the screen's size. The 1280 x 800 Wall holds five day columns and three Up next tiles; the navigation rail
// (6 rem) and the right rail (20 rem) are fixed, so below 1200 px wide the day columns share too little room and Home shows four
// days, and below 760 px tall the three tiles (336 px) leave the list card under them no row and Up next shows two.
export type HomeLayout = { days: 5 | 4; tiles: 3 | 2 };

export function homeLayout({ width, height }: { width: number; height: number }): HomeLayout {
  return { days: width < 1200 ? 4 : 5, tiles: height < 760 ? 2 : 3 };
}

function subscribe(onChange: () => void) {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
}

// Home's layout at the window's size now, drawn again when the window is resized. Each part is read on its own, so a resize that
// changes neither is no render.
export function useHomeLayout(): HomeLayout {
  const size = () => homeLayout({ width: window.innerWidth, height: window.innerHeight });
  return {
    days: useSyncExternalStore(subscribe, () => size().days),
    tiles: useSyncExternalStore(subscribe, () => size().tiles),
  };
}
