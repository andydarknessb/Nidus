import { X } from 'lucide-react';
import { useState } from 'react';
import type { ListItem } from '../lib/shared-lists';
import { EmptyRing, Tick } from './people';
import { Sheet } from './Sheet';
import { Button } from './ui/button';

// Got it, on the Wall and a phone (docs/specs/0019, "The Got it sheet"): the items sent to Target and still waiting, in the list's order,
// every one ticked at first. Cross off crosses off the ticked ones and leaves the rest on the list; Close changes nothing. `onCross` gets
// the ticked ids and returns what did not save ('' when it did); the sheet closes only when it did. The untick set is what the person
// changed: an item that starts waiting while the sheet is open comes in ticked, and one that stops waiting goes out of the count.
export function GotItSheet({ items, onCross, onClose }: { items: ListItem[]; onCross: (came: string[]) => Promise<string>; onClose: () => void }) {
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(() => new Set());
  const ticked = items.filter((item) => !unticked.has(item.id));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  function toggle(id: string) {
    setUnticked((before) => {
      const next = new Set(before);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function crossOff() {
    if (busy) return;
    setBusy(true);
    const failed = await onCross(ticked.map((item) => item.id));
    setBusy(false);
    if (failed) setProblem(failed);
    else onClose();
  }

  return (
    <Sheet
      labelledBy="got-it-title"
      title="Got it?"
      onClose={onClose}
      header={
        <header className="flex shrink-0 items-start justify-between gap-4">
          <h2 id="got-it-title" className="min-w-0 pt-1 font-display text-[30px] leading-9">
            Got it?
          </h2>
          <Button variant="quiet" aria-label="Close" onClick={onClose} className="size-12 rounded-full p-0">
            <X aria-hidden className="size-[26px]" strokeWidth={2.2} />
          </Button>
        </header>
      }
      footer={
        <div className="flex shrink-0 flex-col gap-3">
          {problem && (
            <p role="alert" className="text-base">
              {problem}
            </p>
          )}
          <Button variant="primary" size="phone" className="w-full" aria-disabled={busy || undefined} onClick={() => void crossOff()}>
            Cross off {ticked.length}
          </Button>
        </div>
      }
    >
      <ul className="flex flex-col gap-2">
        {items.map((item) => {
          const on = !unticked.has(item.id);
          return (
            <li key={item.id}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => toggle(item.id)}
                className="flex min-h-12 w-full items-center gap-3 rounded-[14px] bg-muted px-3 py-2 text-left text-[17px] select-none active:bg-accent"
              >
                {on ? <Tick size={28} /> : <EmptyRing size={28} width={2.5} />}
                <span className="min-w-0 flex-1 wrap-anywhere">{item.text}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
