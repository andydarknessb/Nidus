import type { LucideIcon } from 'lucide-react';
import { Moon, Sun, Sunrise } from 'lucide-react';
import { useState } from 'react';
import { TIME_OF_DAY_GROUPS, followClock, holdShown, openChart, partView, pickPart, type ChartPart, type TimeOfDay } from './routines';
import type { RoutinesToday } from './use-routines-today';

// What the Routines chart and the phone's Routines tab share and that is not a component: the words of a tile, the icon of a part of the
// day, the choices of the part-of-day control, the word for a part and the state of which part is shown.

// The words of a tile, whatever they are. A word too long for its line is hyphenated (the page says lang="en") or, where that
// cannot be done, broken onto the next line, and what is past the last line ends in an ellipsis: no letter is ever cut with
// nothing to show it. `dir="auto"` on the element sets the direction from the words, so a right-to-left title starts at the
// right and, when it is cut, is cut at its end; `text-start` follows that direction.
export const WORDS = 'min-w-0 text-start break-words hyphens-auto';

// The icon each part of the day has on the chart's control and over a column.
export const PART_ICON: Record<TimeOfDay, LucideIcon> = { morning: Sunrise, afternoon: Sun, evening: Moon };

// What a Routines screen shows of the day, for the chart and the phone's tab: it opens on the part it is now and moves to a new
// part when that part begins, and a part picked by hand holds until then. It keeps in place what it has shown as left from earlier,
// in this render, so that not one frame of it is drawn with a Routine gone that was ticked a moment ago (see followClock and
// holdShown). What is shown before the day's ticks have been read is not kept: it is not what is left.
export function useChartPart({ settled, part: clock, columns, done }: Pick<RoutinesToday, 'settled' | 'part' | 'columns' | 'done'>) {
  const [chart, setChart] = useState(() => openChart(clock));
  const followed = followClock(chart, clock);
  const shown = followed.part;
  const current = holdShown(
    followed,
    shown === 'whole' || !settled ? [] : columns.flatMap((column) => partView(column.routines, done, shown).earlier.map((routine) => routine.id)),
  );
  if (current !== chart) setChart(current);
  return { shown, held: current.held, pick: (part: ChartPart) => setChart(pickPart(current, part)) };
}

// The words and icon on the chart's control, one choice for each part of the day and one for all of it.
export const CHART_CHOICES: { part: ChartPart; label: string; icon?: LucideIcon }[] = [
  { part: 'morning', label: 'Morning', icon: Sunrise },
  { part: 'afternoon', label: 'Afternoon', icon: Sun },
  { part: 'evening', label: 'Evening', icon: Moon },
  { part: 'whole', label: 'Whole day' },
];

// The word for a time of day. Any time has none: it is the absence of one.
export function timeWord(timeOfDay: TimeOfDay | null): string | undefined {
  return TIME_OF_DAY_GROUPS.find((group) => group.value !== null && group.value === timeOfDay)?.label;
}

