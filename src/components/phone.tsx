import { useId, type ReactNode } from 'react';

// The parts the phone's settings are made of (docs/look.md; the drawing is Light-Phone and Dark-Phone): a page of cards on the
// page ground, a card with its title, and a field with its label above it.

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

// A field's label sits above it, 15 px, in the secondary words; the field itself is drawn by the base rule in index.css.
export const labelClass = 'text-[15px] leading-5 text-muted-foreground';

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
