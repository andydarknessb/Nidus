import { cn } from 'cn';
import { useEffect, useLayoutEffect, useRef, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { dialogKeys, dismissOnScrim } from '../lib/dialog';
import { appBehind, holdBackground } from '../lib/inert-behind';
import { useOverflow, type OverflowControl } from '../lib/use-overflow';
import { InBody } from './InBody';
import { BODY_CLEARANCE, OverflowButton } from './OverflowButton';

// The phone's frame, one for every dialog that is a sheet (Sheet, below, is all of them). Below 768 px
// a sheet rises from the foot (docs/specs/0004, Sheets): the scrim sets it at the bottom with no margin (PHONE_SCRIM), and the dialog
// is full width, 24 round at the top and square at the foot, at most the screen's height less 24 px, 16 px inside and the foot clear
// of the phone's safe area (PHONE_FRAME), with a SheetHandle at its top. There is no animation. At 768 px and wider none of it
// applies: every class is a `phone:` variant, and each sheet keeps the classes it always had.
export const PHONE_SCRIM = 'phone:items-end phone:p-0';
export const PHONE_FRAME =
  'phone:max-h-[calc(100%-24px)] phone:max-w-none phone:rounded-t-3xl phone:rounded-b-none phone:p-4 phone:pb-[calc(1rem+env(safe-area-inset-bottom))]';

// The handle at the top of a phone sheet: 40 by 4 in --input, centred, decorative (aria-hidden) and not drawn at 768 px and wider. It is
// the dialog's first child, so a screen reader meets the title first.
export function SheetHandle() {
  return <span aria-hidden="true" data-sheet-handle="" className="hidden h-1 w-10 flex-none self-center rounded-full bg-input phone:block" />;
}

// A sheet over the Wall (docs/look.md): a card, 28 round, on the scrim. It is the one frame of every sheet: an event's details, the list
// a crowded cluster opens, the Add and Edit event form and the meal sheet. A modal dialog: focus moves in on open (to the dialog, or to
// `initialFocus`) and back to what opened it on close, Tab and Shift+Tab stay inside it (aria-modal), and Escape and Close always close
// it. A tap on the scrim closes it when `canDismiss` says so (always, by default): the forms say not while something has been typed or
// changed. The page behind it is inert while it is open, so a screen reader cannot swipe out of it, and so is a sheet it is opened over
// (the time sheet over the Add event form); it is drawn in the body, outside what is made inert (InBody). `labelledBy` is the id of
// the title in `header`, and `title` is the same words, which name the body's button ("More of Piano"). The title row (`header`) and
// the footer stay in view whatever the body holds: the dialog does not scroll, the body between them does (SheetBody), unless the sheet
// is `plain` and draws its own. `onSubmit` makes the dialog a form. `refocusOn` is a value that changes when a control in the sheet
// may have gone or been switched off (saving, a question): focus is then put back on the sheet if it fell out of it. `scrim` is for a
// scrim that differs (its room round the card).
export function Sheet({
  labelledBy,
  title,
  onClose,
  canDismiss,
  className,
  scrim,
  onSubmit,
  initialFocus,
  refocusOn,
  plain = false,
  header,
  footer,
  children,
}: {
  labelledBy: string;
  title: string;
  onClose: () => void;
  canDismiss?: () => boolean;
  className?: string;
  scrim?: string;
  onSubmit?: (event: FormEvent) => void;
  initialFocus?: RefObject<HTMLElement | null>;
  refocusOn?: unknown;
  plain?: boolean;
  header: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  // A div or a form, whichever the dialog is: both are the one element it holds focus with.
  const dialog = useRef<HTMLDivElement & HTMLFormElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const body = useOverflow('y', 'over');

  // The page behind is inert for as long as the sheet is open, and let go of before focus goes back to what opened the sheet (an inert
  // element takes no focus). The opener is noted first: making the page inert takes the focus off it.
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const release = holdBackground(appBehind(layer.current));
    (initialFocus?.current ?? dialog.current)?.focus();
    return () => {
      release();
      opener?.focus();
    };
  }, [initialFocus]);

  // A button that had focus may go (Keep it) or be switched off (saving): the browser lets focus go a moment after this runs, so a
  // disabled button still counts as lost. Escape and Tab would no longer reach the sheet, so it is put back on the sheet itself, not on
  // a field, so that a tapped Save does not bring a tablet's keyboard back up.
  useEffect(() => {
    const active = document.activeElement;
    if (!dialog.current?.contains(active) || (active instanceof HTMLButtonElement && active.disabled)) dialog.current?.focus();
  }, [refocusOn]);

  const inside = (
    <>
      <SheetHandle />
      {header}
      {plain ? (
        children
      ) : (
        <SheetBody title={title} control={body}>
          {children}
        </SheetBody>
      )}
      {footer}
    </>
  );
  const frame = {
    ref: dialog,
    role: 'dialog',
    'aria-modal': true,
    'aria-labelledby': labelledBy,
    tabIndex: -1,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => dialogKeys(event, onClose),
    className: cn('flex max-h-full min-h-0 w-full flex-col gap-5 rounded-[28px] bg-card p-6 outline-none', PHONE_FRAME, className),
  };

  return (
    <InBody>
      <div
        ref={layer}
        // What another sheet opened over this one holds inert (A_SHEET).
        data-sheet=""
        className={cn('fixed inset-0 z-20 flex items-center justify-center bg-scrim p-4', scrim, PHONE_SCRIM)}
        // A press on the scrim must not take the focus off what had it. A sheet that stays open (something was typed) would otherwise
        // have its focus on the page behind it, and Escape, which the sheet hears, would never reach it.
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) event.preventDefault();
        }}
        onClick={(event) => dismissOnScrim(event, onClose, canDismiss)}
      >
        {onSubmit ? (
          <form {...frame} noValidate onSubmit={onSubmit}>
            {inside}
          </form>
        ) : (
          <div {...frame}>{inside}</div>
        )}
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
