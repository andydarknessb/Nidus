import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from './ui/button';

// The parts the phone's settings are made of (docs/look.md; the drawing is Light-Phone and Dark-Phone): a page of cards on the
// page ground, a card with its title, a field with its label above it, and the question before something is taken away.

// A page of the phone's settings: its cards 12 px apart under the tabs, and room at the foot, past where the status line overlays
// the screen for six seconds, so that the last card is never under it. The page's title is for a screen reader: the tab that is
// current says it to everyone else.
export function PhonePage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 pb-24">
      <h1 className="sr-only">{title}</h1>
      {children}
    </main>
  );
}

// A card: --card on the page ground, radius 24, padding 16, its parts 16 apart. Told apart from the page by its fill and no outline.
export const cardClass = 'flex flex-col gap-4 rounded-3xl bg-card p-4';

// A card with its title in the display face, which names the region.
export function Card({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cardClass}>
      <h2 id={id} className="font-display text-[22px] leading-7">
        {title}
      </h2>
      {children}
    </section>
  );
}

// A field's label sits above it, 15 px, in the secondary words; the field itself is drawn by the base rule in index.css, 56 tall.
export const labelClass = 'text-[15px] leading-5 text-muted-foreground';
export const fieldClass = 'h-14 w-full text-[17px]';

// A line of help under a field or a control, 14 px.
export const helpClass = 'text-sm leading-5 text-muted-foreground';

// A label and the control it names: the control is the label's child, so a tap on the words reaches it.
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  );
}

// Before something that cannot be undone: what is about to happen, in words, and the two ways out, the safe one first and the one
// that does it in the delete voice, with room for a name. It takes the focus when it opens, so a screen reader reads what is about
// to happen before it can be done.
export function Confirm({
  title,
  words,
  cancel,
  confirm,
  busy = false,
  onCancel,
  onConfirm,
}: {
  title: string;
  words: string;
  cancel: string;
  confirm: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <div className="flex flex-col gap-3">
      <h3 ref={heading} tabIndex={-1} className="text-[17px] leading-6 font-semibold">
        {title}
      </h3>
      <p className="text-base leading-6">{words}</p>
      <div className="flex gap-2">
        <Button variant="secondary" size="phone" className="flex-1" onClick={onCancel}>
          {cancel}
        </Button>
        <Button variant="delete" size="phone" className="h-auto min-h-14 flex-[2] py-2 whitespace-normal" disabled={busy} onClick={onConfirm}>
          {confirm}
        </Button>
      </div>
    </div>
  );
}
