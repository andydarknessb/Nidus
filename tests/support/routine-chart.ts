import type { Profile } from '../../src/lib/profiles';
import {
  routineChart,
  startChart,
  tickedRead,
  type ChartEffects,
  type ChartFacts,
  type ChartRead,
  type RoutineChart,
} from '../../src/lib/routine-chart';
import type { Routine, TimeOfDay } from '../../src/lib/routines';
import type { ReadStateName } from '../../src/lib/synced-read';

// The Routine Chart's core (src/lib/routine-chart.ts) as a test drives it: the facts the hook reads, the state the hook keeps, and effects
// that act on a read of Routine Completions as the synced read does (a tick shows at once and is taken back when the write fails), so a
// test taps and looks at the chart again exactly as a screen does. Nothing here reaches the database; tests/routine-chart.test.ts has the
// one case that does.

export type SceneOptions = {
  profiles: Profile[] | null;
  routines: Routine[];
  // The ids ticked today.
  done?: Iterable<string>;
  // Thursday 2026-10-01 unless said, and in the evening.
  date?: string | null;
  weekday?: number;
  clock?: TimeOfDay;
  // Nothing read yet, or a read made for another day (just after Household midnight), or the read failing.
  unread?: boolean;
  unsettled?: boolean;
  readState?: ReadStateName;
  failed?: boolean;
  // What the last tick of each Profile (by id) that did not save says, said on the day of the chart.
  problems?: Record<string, string>;
};

export const THURSDAY = '2026-10-01';

export function scene(options: SceneOptions) {
  const date = options.date === undefined ? THURSDAY : options.date;
  const read: ChartRead | null = options.unread ? null : { date: options.unsettled ? '2026-09-30' : (date ?? THURSDAY), routines: options.routines, done: new Set(options.done ?? []) };
  const facts: ChartFacts = {
    date,
    weekday: options.weekday ?? 4,
    clock: options.clock ?? 'evening',
    profiles: options.profiles,
    read,
    readState: options.readState ?? (read === null ? 'loading' : 'ready'),
    failed: options.failed ?? false,
  };
  const world = {
    facts,
    state: { ...startChart(facts.clock), problems: { day: date ?? '', says: options.problems ?? {} } },
    // What each write was, in order, and the bursts playing the moment it began.
    writes: [] as { routine: string; checking: boolean; date: string; bursts: string[] }[],
    // The screen is offline when a tick fails; someone asked for less motion; the write fails; the write waits for `open`.
    offline: false,
    calm: false,
    fails: false as boolean | ((routineId: string) => boolean),
    gate: null as Promise<void> | null,
    // Whether a tick changes the read the way the synced read does.
    ticks: true,
    time: 1_000,
    effects: undefined as unknown as ChartEffects,
    // The chart now, as the hook builds it: the state it keeps is kept.
    chart(): RoutineChart {
      const chart = routineChart(world.facts, world.state, world.effects);
      world.state = chart.kept;
      return chart;
    },
    // The part the chart shows, as the clock and a pick by hand leave it.
    show(part: TimeOfDay | 'whole', held: Iterable<string> = []) {
      const clock = part === 'whole' ? world.facts.clock : part;
      world.facts = { ...world.facts, clock };
      world.state = { ...world.state, chart: { part, clock, held: new Set(held) } };
    },
    // What was read, with its ticks, for changing them as another screen would.
    get done(): Set<string> {
      return world.facts.read!.done;
    },
  };
  world.effects = {
    async write(routine, checking, on) {
      world.writes.push({ routine: routine.id, checking, date: on, bursts: Object.keys(world.state.celebration.bursts) });
      // The tick shows at once as a new read, so a chart drawn before it keeps the ticks it was drawn with.
      const tick = (checked: boolean) => {
        if (world.ticks && world.facts.read) world.facts = { ...world.facts, read: tickedRead(world.facts.read, routine.id, checked, on) };
      };
      tick(checking);
      await world.gate;
      if (typeof world.fails === 'function' ? world.fails(routine.id) : world.fails) {
        tick(!checking);
        throw new Error('That did not save');
      }
    },
    change(update) {
      world.state = update(world.state);
    },
    offline: () => world.offline,
    calm: () => world.calm,
    now: () => world.time,
  };
  return world;
}

// The chart for these facts, built once, as a screen is first drawn.
export const chartOf = (options: SceneOptions): RoutineChart => scene(options).chart();
