import { cn } from 'cn';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { dialogKeys } from '../lib/dialog';
import { appBehind, holdBackground } from '../lib/inert-behind';
import { useOverflow, type OverflowControl } from '../lib/use-overflow';
import { InBody } from './InBody';
import { BODY_CLEARANCE, OverflowButton } from './OverflowButton';

// The phone's frame, one for the three dialogs that are a sheet (this one, the Native Event sheet and the meal sheet). Below 768 px
// a sheet rises from the foot (docs/specs/0004, Sheets): the scrim sets it at the bottom with no margin (PHONE_SCRIM), and the dialog
// is full width, 24 round at the top and square at the foot, at most the screen's height less 24 px, 16 px inside and the foot clear
// of the phone's safe area (PHONE_FRAME), with a SheetHandle at its top. There is no animation. At 768 px and wider none of it
// applies: every class is a `max-[768px]:` variant, and each sheet keeps the classes it always had.
export const PHONE_SCRIM = 'max-[768px]:items-end max-[768px]:p-0';
export const PHONE_FRAME =
  'max-[768px]:max-h-[calc(100%-24px)] max-[768px]:max-w-none max-[768px]:rounded-t-3xl max-[768px]:rounded-b-none max-[768px]:p-4 max-[768px]:pb-[calc(1rem+env(safe-area-inset-bottom))]';

// The handle at the top of a phone sheet: 40 by 4 in --input, centred, decorative (aria-hidden) and not drawn at 768 px and wider. It is
// the dialog's first child, so a screen reader meets the title first.
export function SheetHandle() {
  return <span aria-hidden="true" data-sheet-handle="" className="hidden h-1 w-10 flex-none self-center rounded-full bg-input max-[768px]:block" />;
}

// A sheet over the Wall (docs/look.md): a card, 28 round, on the scrim. It is the one frame of an event's details and of the list
// a crowded cluster opens. A modal dialog: focus moves in on open and back to what opened it on close, Tab and Shift+Tab stay
// inside it (aria-modal), and Escape and a tap on the scrim close it. The page behind it is inert while it is open, so a screen
// reader cannot swipe out of it, and it is drawn in the body, outside what is made inert (InBody). `labelledBy` is the id of the
// title in `header`, and `title` is the same words, which name the body's button ("More of Piano"). The title row (`header`) and the
// footer stay in view whatever the body holds: the dialog does not scroll, the body between them does (SheetBody). The Add event
// sheet keeps a frame of its own, because a tap outside it closes it only while nothing has been typed; it has a SheetBody too.
export function Sheet({
  labelledBy,
  title,
  onClose,
  className,
  header,
  footer,
  children,
}: {
  labelledBy: string;
  title: string;
  onClose: () => void;
  className?: string;
  header: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const body = useOverflow('y', 'over');

  // The page behind is inert for as long as the sheet is open, and let go of before focus goes back to what opened the sheet (an inert
  // element takes no focus). The opener is noted first: making the page inert takes the focus off it.
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const release = holdBackground(appBehind());
    dialog.current?.focus();
    return () => {
      release();
      opener?.focus();
    };
  }, []);

  return (
    <InBody>
      <div
        className={cn('fixed inset-0 z-20 flex items-center justify-center bg-scrim p-4', PHONE_SCRIM)}
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div
          ref={dialog}
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          tabIndex={-1}
          onKeyDown={(event) => dialogKeys(event, onClose)}
          className={cn('flex max-h-full min-h-0 w-full flex-col gap-5 rounded-[28px] bg-card p-6 outline-none', PHONE_FRAME, className)}
        >
          <SheetHandle />
          {header}
          <SheetBody title={title} control={body}>
            {children}
          </SheetBody>
          {footer}
        </div>
      </div>
    </InBody>
  );
}

// The body of a sheet, between its title row and its footer: the one box that scrolls. A tablet in a kiosk browser draws no
// scrollbars, so a body that holds more than it shows says so with the shared foot button (OverflowButton) over its end, "More of
// <the sheet's title>" and "Back to the top of <the sheet's title>", and the footer never leaves the screen. `control` is what the
// sheet has measured of the box (useOverflow). The padding is room for a focus ring at the edge of the box, taken back by the
// margin; it is on the wrapper the content is in, so the foot sticks flush with the box's end and its button lines up with the
// content, and the wrapper is what the clearance is on (BODY_CLEARANCE), so what takes the keyboard's focus is scrolled clear of the
// foot. Below 960 px a sheet is one column on a phone, which scrolls by touch, and the foot is not drawn.
export function SheetBody({ title, control, children }: { title: string; control: OverflowControl; children: ReactNode }) {
  return (
    <div ref={control.scroller} className="-m-1 min-h-0 flex-1 overflow-y-auto">
      <div className={cn('p-1', BODY_CLEARANCE)}>{children}</div>
      <OverflowButton control={control} of={title} className="px-1 max-[959px]:hidden" />
    </div>
  );
}
