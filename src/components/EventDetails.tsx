import { useEffect, useRef } from 'react';
import { describeWhen, type Occurrence } from '../lib/calendar-occurrences';

// The details of one event, over the wall: title, when, where, notes and which calendar it
// came from. Read-only (a Synced Event is never edited here). Focus moves in on open and back
// to the tapped event on close; Escape, the backdrop and the button all close it.
export function EventDetails({ occurrence, timezone, onClose }: { occurrence: Occurrence; timezone: string; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => opener?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-10 flex items-center justify-center bg-background/90 p-8"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-details-title"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
          if (event.key !== 'Tab') return;
          // aria-modal: Tab and Shift+Tab stay inside the sheet instead of reaching the wall behind it.
          const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])')];
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (!first || !last) {
            event.preventDefault();
          } else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
        className="flex max-h-full w-full max-w-3xl flex-col gap-6 overflow-y-auto rounded-xl border-2 border-border bg-card p-8 outline-none"
      >
        <header className="flex items-start justify-between gap-6">
          <h2 id="event-details-title" className="text-4xl font-semibold break-words">
            {occurrence.title}
          </h2>
          <button type="button" className="min-h-12 shrink-0 rounded-lg border border-border px-6 text-lg font-medium" onClick={onClose}>
            Close
          </button>
        </header>
        <dl className="flex flex-col gap-5 text-2xl">
          <Detail label="When">{describeWhen(occurrence, timezone)}</Detail>
          {occurrence.location && <Detail label="Where">{occurrence.location}</Detail>}
          {occurrence.description && <Detail label="Notes">{occurrence.description}</Detail>}
          <Detail label="Calendar">{occurrence.calendar_name}</Detail>
        </dl>
      </div>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-lg font-semibold">{label}</dt>
      {/* Plain text: a description from Google may hold markup, which is never rendered. */}
      <dd className="break-words whitespace-pre-wrap">{children}</dd>
    </div>
  );
}
