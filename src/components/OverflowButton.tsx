import { cn } from 'cn';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { overflowWords } from '../lib/overflow';
import type { OverflowControl } from '../lib/use-overflow';
import { Button } from './ui/button';

// The button that says a row or a column scrolls (docs/look.md, The parts, Overflow). A tablet in a kiosk browser draws no
// scrollbars, so what a row or a column holds past its edge would be hidden with no sign. The button is drawn only while the box
// overflows (`control`, from useOverflow). It reads "More people", "More lists" or "More" with a chevron pointing on, and moves
// the box on by most of a page; at the end it reads "Back" with a chevron pointing back and returns the box to its start, so it
// is never switched off, and nobody is left at the far end with no way back that they can see. It is a secondary button, never
// the primary one.
//
// Both words are drawn in one place, the one not showing invisible, so the button is as wide as the wider of the two and does not
// change size, or move what is beside it, when it says "Back". Its accessible name says what moves (overflowWords).
//
// In a row it is a button of its own, beside the row or in the screen's heading row. In a column it is the column's foot: the last
// thing the column's list holds, stuck to the foot of what the list shows while there is more below, over a short fade in the colour
// the list sits on, so the tiles run out under it. At rest a tile may sit partly under the foot. The fade is a dead band: it takes a
// tap and does nothing with it, so a tap just above the button never ticks the tile under it (a click 8 px into a fade that let taps
// through did), and 1 px above the button is the foot, not a tile. A touch that starts on it still scrolls the list, and every tile is
// still reached, by pressing More. The foot is in the list's flow, so the list ends with room for it and the last tile can always be
// scrolled clear of it. A tile scrolled to (the keyboard's focus, a new item) stops FOOT_CLEARANCE short of the foot, so it is scrolled
// clear of it. The clearance is on the list's items and not on the list, which would make the browser scroll the list when the foot's
// own button takes the focus.

// The foot is 64 px: the button's 48 and a 16 px fade above it. An item scrolls to 72 px clear of the end of the list: the foot, and
// 8 px more for the room a focus ring takes outside a tile.
export const FOOT_CLEARANCE = '[&_li]:scroll-mb-18 [&_li_button]:scroll-mb-18';

// What a column's foot sits on: the fade is in that colour, and the button is the surface that is told apart from it (a card on a
// person's column, as the tiles are; a row's colour on a card, as the items are).
export type Surface = 'card' | 'person';
const SURFACE: Record<Surface, { fade: string; button: string }> = {
  card: { fade: 'from-card', button: '' },
  person: { fade: 'from-person-soft', button: 'bg-card' },
};

const LABEL = 'col-start-1 row-start-1 flex items-center justify-center gap-1';

// `className` is for the box this draws: the button, in a row; the foot that holds it, in a column.
export function OverflowButton({ control, of, surface = 'card', className }: { control: OverflowControl; of: string; surface?: Surface; className?: string }) {
  if (!control.overflowing) return null;
  const { axis, atEnd } = control;
  const column = axis === 'y';
  const words = overflowWords(axis, of);
  const Onward = column ? ChevronDown : ChevronRight;
  const Backward = column ? ChevronUp : ChevronLeft;

  const button = (
    <Button
      // A row's button is measured itself; a column's foot is, and holds this.
      ref={column ? undefined : control.piece}
      variant="secondary"
      aria-label={atEnd ? words.back.name : words.more.name}
      onClick={control.step}
      className={
        column
          ? cn('h-12 w-full gap-1 rounded-[14px] px-3.5 text-sm focus-visible:-outline-offset-2', SURFACE[surface].button)
          : cn('h-14 gap-1 rounded-[18px] bg-card px-3.5 text-sm', className)
      }
    >
      <span className="grid">
        <span aria-hidden={atEnd || undefined} className={cn(LABEL, atEnd && 'invisible')}>
          {words.more.text}
          <Onward aria-hidden className="size-[18px]" />
        </span>
        <span aria-hidden={!atEnd || undefined} className={cn(LABEL, !atEnd && 'invisible')}>
          <Backward aria-hidden className="size-[18px]" />
          {words.back.text}
        </span>
      </span>
    </Button>
  );
  if (!column) return button;

  return (
    <div ref={control.piece} className={cn('sticky bottom-0 flex h-16 shrink-0 items-end bg-linear-to-t from-75% to-transparent', SURFACE[surface].fade, className)}>
      {button}
    </div>
  );
}
