import { cn } from 'cn';
import { Check, House } from 'lucide-react';
import type { CSSProperties } from 'react';
import { personStyle } from '../lib/look';
import { initialOf } from '../lib/profiles';

// The parts a person is drawn from (docs/look.md): the disc with their initial, the house disc for the whole
// Household, the empty ring, the tick and the pips. Each is decorative and its size is in pixels, so a screen
// says "a 40 px disc" the way the drawings do. A part drawn in a person's colour takes `color`, the Profile's stored
// colour, and carries the class `person` and the four steps itself: it needs no `person` ancestor to be in the right
// colour, and an ancestor's colours never reach it.

// An initial inside a disc is the one exception to the 14 px floor: 46% of the disc, never under 11 px.
const initialSize = (disc: number) => Math.max(11, Math.round(disc * 0.46));

// An icon in a disc is sized in its own style. A Button gives every icon that has no size- class 20 px
// (`[&_svg:not([class*=size-])]:size-5`), and a stylesheet rule beats the width and height attributes lucide sets, so a house in
// a 24 px disc inside a Button was drawn at 20 px. A style beats that rule, so the icon is the size the disc asks for wherever
// the disc is drawn.
const iconSize = (px: number): CSSProperties => ({ width: px, height: px });

// A person: a disc in their strong colour with their initial, at 24, 34, 40, 44 or 56 px. The name is always beside
// it, so it is hidden from a screen reader.
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
      <House style={iconSize(Math.round(size * 0.54))} strokeWidth={2.4} />
    </span>
  );
}

// An empty ring waiting for a tick: --input, or with `color` that person's strong colour (a to-do Routine's tile).
export function EmptyRing({ size = 44, width = 3, color, className }: { size?: number; width?: number; color?: string | undefined; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('shrink-0 rounded-full', color === undefined ? 'text-input' : 'person text-person-strong', className)}
      style={{ ...(color === undefined ? {} : personStyle(color)), width: size, height: size, boxShadow: `inset 0 0 0 ${width}px currentColor` }}
    />
  );
}

// A filled tick: in --primary, or with `color` in that person's tick pair, which is for a finished tile. With `strong` as
// well it is their strong pair instead, which is for beside their progress. `strong` means nothing without `color`.
export function Tick({ size = 44, color, strong = false, className }: { size?: number; color?: string | undefined; strong?: boolean; className?: string }) {
  const look = color === undefined ? 'bg-primary text-primary-foreground' : strong ? 'person bg-person-strong text-person-on-strong' : 'person bg-person-tick text-person-on-tick';
  return (
    <span aria-hidden className={cn('flex shrink-0 items-center justify-center rounded-full', look, className)} style={{ ...(color === undefined ? {} : personStyle(color)), width: size, height: size }}>
      <Check style={iconSize(Math.round(size * 0.55))} strokeWidth={3.2} />
    </span>
  );
}

// Past this many Routines the count alone says how far someone is.
export const MAX_PIPS = 8;

// Progress: one pip for each of `total`, filled in the person's strong colour for each one `done`, the others a
// 1.5 px --input ring. It draws nothing for no Routines, or for more than MAX_PIPS: show the count instead. `label` is
// what a screen reader hears ("Ava, 3 of 5 routines done").
export function Pips({ done, total, label, color, height = 6 }: { done: number; total: number; label: string; color: string; height?: number }) {
  if (total === 0 || total > MAX_PIPS) return null;
  return (
    <span role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} className="person flex gap-1" style={personStyle(color)}>
      {Array.from({ length: total }, (_, index) => (
        <span key={index} className={cn('flex-1 rounded-full', index < done ? 'bg-person-strong' : 'shadow-[inset_0_0_0_1.5px_var(--input)]')} style={{ height }} />
      ))}
    </span>
  );
}
