import { cn } from 'cn';
import { useEffect, useRef, type ReactNode } from 'react';
import { dialogKeys } from '../lib/dialog';

// A sheet over the Wall (docs/look.md): a card, 28 round, on the scrim. It is the one frame of an event's details and of the list
// a crowded cluster opens. A modal dialog: focus moves in on open and back to what opened it on close, Tab and Shift+Tab stay
// inside it (aria-modal), and Escape and a tap on the scrim close it. `labelledBy` is the id of its title. The Add event sheet
// keeps a frame of its own, because a tap outside it closes it only while nothing has been typed.
export function Sheet({ labelledBy, onClose, className, children }: { labelledBy: string; onClose: () => void; className?: string; children: ReactNode }) {
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => opener?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-10 flex items-center justify-center bg-scrim p-4"
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
        className={cn('flex max-h-full w-full flex-col gap-5 overflow-y-auto rounded-[28px] bg-card p-6 outline-none', className)}
      >
        {children}
      </div>
    </div>
  );
}
