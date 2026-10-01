import { Pin } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { describeWhen, type Occurrence } from '../lib/calendar-occurrences';
import { dialogKeys } from '../lib/dialog';

// The details of one event, over the wall: title, when, where, notes and which calendar it
// came from. A Synced Event is read-only (it is never edited here); a Native Event says it lives
// only in Nidus and offers Edit when `onEdit` is given. Focus moves in on open and back to the
// tapped event on close; Escape, the backdrop and the button all close it.
export function EventDetails({
  occurrence,
  timezone,
  onClose,
  onEdit,
}: {
  occurrence: Occurrence;
  timezone: string;
  onClose: () => void;
  onEdit?: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const native = occurrence.source === 'native';

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
        // aria-modal: Tab and Shift+Tab stay inside the sheet instead of reaching the wall behind it.
        onKeyDown={(event) => dialogKeys(event, onClose)}
        className="flex max-h-full w-full max-w-3xl flex-col gap-6 overflow-y-auto rounded-xl border-2 border-border bg-card p-8 outline-none"
      >
        <header className="flex items-start justify-between gap-6">
          <h2 id="event-details-title" className="text-4xl font-semibold break-words">
            {occurrence.title}
          </h2>
          <div className="flex shrink-0 gap-3">
            {native && onEdit && (
              <button type="button" className="min-h-12 rounded-lg border border-border px-6 text-lg font-medium" onClick={onEdit}>
                Edit
              </button>
            )}
            <button type="button" className="min-h-12 rounded-lg border border-border px-6 text-lg font-medium" onClick={onClose}>
              Close
            </button>
          </div>
        </header>
        {native && (
          <p className="flex items-center gap-3 text-xl font-semibold">
            <Pin aria-hidden className="size-6 shrink-0" />
            Only in Nidus. It is not in Google Calendar.
          </p>
        )}
        <dl className="flex flex-col gap-5 text-2xl">
          <Detail label="When">{describeWhen(occurrence, timezone)}</Detail>
          {occurrence.location && <Detail label="Where">{occurrence.location}</Detail>}
          {occurrence.description && <Detail label="Notes">{occurrence.description}</Detail>}
          {!native && <Detail label="Calendar">{occurrence.calendar_name}</Detail>}
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
