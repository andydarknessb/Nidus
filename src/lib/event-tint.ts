import type { CSSProperties } from 'react';
import type { Occurrence } from './calendar-occurrences';

// How an occurrence is coloured on the wall, shared by the five-day grid and the month's cells.

// Events with no colour (a whole-Household calendar) still need an edge to read against.
const NEUTRAL = '#d4d4d8';

// A tinted block in the event's colour: the colour is the edge and a wash, never the text, so
// the words stay white on a dark ground whatever colour the Profile picked.
// An event for several Profiles splits its edge into one stripe of each colour.
export function tint(occurrence: Occurrence): CSSProperties {
  const edge = occurrence.color ?? NEUTRAL;
  const wash = `color-mix(in srgb, ${edge} 24%, #18181b)`;
  const { colors } = occurrence;
  if (colors.length < 2) return { borderLeftColor: edge, backgroundColor: wash };
  const stops = colors.map((color, index) => `${color} ${(index * 100) / colors.length}% ${((index + 1) * 100) / colors.length}%`).join(', ');
  return {
    borderLeftColor: 'transparent',
    backgroundImage: `linear-gradient(to bottom, ${stops}), linear-gradient(${wash}, ${wash})`,
    backgroundSize: '8px 100%, 100% 100%',
    backgroundPosition: 'left top, left top',
    backgroundRepeat: 'no-repeat',
    backgroundOrigin: 'border-box',
  };
}
