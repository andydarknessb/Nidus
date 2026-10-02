import { cn } from 'cn';
import { Check, House } from 'lucide-react';
import { personStyle } from '../lib/look';
import { initialOf } from '../lib/profiles';

// The parts a person is drawn from (docs/look.md): the disc with their initial, the house disc for the whole
// Household, the empty ring, the tick and the pips. Each is decorative and its size is in pixels, so a screen
// says "a 40 px disc" the way the drawings do. A person's colours come from the class `person` (see
// personStyle() in lib/look.ts); only PersonDisc brings its own.

// An initial inside a disc is the one exception to the 14 px floor: 46% of the disc, never under 11 px.
const initialSize = (disc: number) => Math.max(11, Math.round(disc * 0.46));

// A person: a disc in their strong colour with their initial, at 24, 34, 40, 44 or 56 px. `color` is the Profile's
// stored colour. The name is always beside it, so it is hidden from a screen reader.
export function PersonDisc({ name, color, size = 40 }: { name: string; color: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="person flex shrink-0 items-center justify-center rounded-full bg-person-strong leading-none font-semibold text-person-on-strong"
      style={{ ...personStyle(color), width: size, height: size, fontSize: initialSize(size) }}
    >
      {initialOf(name)}
    </span>
  );
}

// Everyone, the whole Household: the same disc in --primary with a house in it.
export function HouseDisc({ size = 40 }: { size?: number }) {
  return (
    <span aria-hidden className="flex shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground" style={{ width: size, height: size }}>
      <House size={Math.round(size * 0.54)} strokeWidth={2.4} />
    </span>
  );
}

// An empty ring waiting for a tick. It is drawn in the text colour, --input unless `className` sets another
// (text-person-strong on a Routine's tile).
export function EmptyRing({ size = 44, width = 3, className }: { size?: number; width?: number; className?: string }) {
  return <span aria-hidden className={cn('shrink-0 rounded-full text-input', className)} style={{ width: size, height: size, boxShadow: `inset 0 0 0 ${width}px currentColor` }} />;
}

// A filled tick, in --primary unless `className` sets another pair (bg-person-tick text-person-on-tick on a finished
// tile, bg-person-strong text-person-on-strong beside a person's progress).
export function Tick({ size = 44, className }: { size?: number; className?: string }) {
  return (
    <span aria-hidden className={cn('flex shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground', className)} style={{ width: size, height: size }}>
      <Check size={Math.round(size * 0.55)} strokeWidth={3.2} />
    </span>
  );
}

// Past this many Routines the count alone says how far someone is.
export const MAX_PIPS = 8;

// Progress: one pip for each of `total`, filled in the person's strong colour for each one `done`, the others a
// 1.5 px --input ring. Put it inside an element with the class `person`. It draws nothing for no Routines, or for
// more than MAX_PIPS: show the count instead. `label` is what a screen reader hears ("Ava: 3 of 5 Routines done").
export function Pips({ done, total, label, height = 6 }: { done: number; total: number; label: string; height?: number }) {
  if (total === 0 || total > MAX_PIPS) return null;
  return (
    <span role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} className="flex gap-1">
      {Array.from({ length: total }, (_, index) => (
        <span key={index} className={cn('flex-1 rounded-full', index < done ? 'bg-person-strong' : 'shadow-[inset_0_0_0_1.5px_var(--input)]')} style={{ height }} />
      ))}
    </span>
  );
}
