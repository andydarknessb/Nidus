import { useEffect, useId, useRef, type ReactNode } from 'react';
import { type Said } from '@/lib/write-failure';
import { Button } from './ui/button';

// The parts the phone's settings are made of (docs/look.md; the drawing is Light-Phone and Dark-Phone): a page of cards on the
// page ground, a card with its title, a field with its label above it, what a write that failed says, and the question before
// something is taken away.

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

// A status line (role="status") that is on the page from the first draw, so a screen reader has it before it speaks, and takes no room
// while it is empty: out of the layout (and out of its parent's gap), but still in the accessibility tree.
export const statusLineClass = 'text-base empty:sr-only';

// A field's label sits above it, 15 px, in the secondary words; the field itself is drawn by the base rule in index.css, 56 tall.
export const labelClass = 'text-[15px] leading-5 text-muted-foreground break-words';
export const fieldClass = 'h-14 w-full text-[17px]';

// A line of help under a field or a control, 14 px.
export const helpClass = 'text-sm leading-5 text-muted-foreground';

// Two buttons side by side that wrap, each taking what it needs and the rest between them, when a narrow phone has no room for
// both: the way out first, then what it does (`buttonWide`, twice the room, when what it does carries a name). A button does not
// shrink by itself (the base rule), so a row says that it may: one whose name is a single long word is then alone on its line,
// as wide as the card, and breaks inside the word.
export const buttonRow = 'flex flex-wrap gap-2';
export const buttonHalf = 'shrink grow basis-auto';
export const buttonWide = 'shrink grow-[2] basis-auto';

// A label and the control it names: the control is the label's child, so a tap on the words reaches it.
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  );
}

// What a write that did not go through says, where the person is looking: inside the open form or under the row that failed,
// below the button they pressed so that nothing they are pressing moves. It is an alert, so it is said at once, and it scrolls
// itself into view when it appears (clear of the tabs: html has scroll-padding-top), so it is on the screen whatever was.
export function Problem({ id, problem }: { id: string; problem: Said | null | undefined }) {
  const line = useRef<HTMLParagraphElement>(null);
  const words = problem?.words;
  const said = problem?.n;
  useEffect(() => {
    line.current?.scrollIntoView({ block: 'nearest' });
  }, [words, said]);
  if (!problem) return null;
  // Each failure is a new element, so that a retry that fails again is said again, though its words are the same.
  return (
    <p key={said} ref={line} id={id} role="alert" className="text-base leading-6">
      {problem.words}
    </p>
  );
}

// Before something that cannot be undone: what is about to happen, in words, and the two ways out, the safe one first and the one
// that does it in the delete voice, with room for a name. It is a group named by its question; the focus goes to the safe answer,
// which is described by the question's words, so a screen reader reads the question, what goes, and the answer it is on; Escape
// is that answer. While what it asks is on its way both buttons are `aria-disabled` and do nothing, so nobody is told it was
// cancelled when it was not. What went wrong, when it did, is said under the buttons.
export function Confirm({
  title,
  words,
  cancel,
  confirm,
  busy = false,
  problem,
  onCancel,
  onConfirm,
}: {
  title: string;
  words: string;
  cancel: string;
  confirm: string;
  busy?: boolean;
  problem?: Said | null | undefined;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const safe = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const wordsId = useId();
  const problemId = useId();
  useEffect(() => safe.current?.focus(), []);
  const cancelIt = () => {
    if (!busy) onCancel();
  };
  const describedBy = problem ? `${wordsId} ${problemId}` : wordsId;
  return (
    <div
      role="group"
      aria-labelledby={titleId}
      className="flex flex-col gap-3 rounded-lg"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        cancelIt();
      }}
    >
      <h3 id={titleId} className="text-[17px] leading-6 font-semibold break-words">
        {title}
      </h3>
      <p id={wordsId} className="text-base leading-6">
        {words}
      </p>
      <div className={buttonRow}>
        <Button ref={safe} variant="secondary" size="phone" className={buttonHalf} aria-disabled={busy || undefined} aria-describedby={describedBy} onClick={cancelIt}>
          {cancel}
        </Button>
        <Button
          variant="delete"
          size="phone"
          className={`h-auto min-h-14 py-2 whitespace-normal [overflow-wrap:anywhere] ${buttonWide}`}
          aria-disabled={busy || undefined}
          aria-describedby={describedBy}
          onClick={() => {
            if (!busy) onConfirm();
          }}
        >
          {confirm}
        </Button>
      </div>
      <Problem id={problemId} problem={problem} />
    </div>
  );
}
