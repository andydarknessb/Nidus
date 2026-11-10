import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CardWriteOutcome } from '../lib/change';
import { chatGptLink, createSend, targetMessage } from '../lib/send-to-target';
import type { ListItem } from '../lib/shared-lists';
import { couldNotLoad } from '../lib/synced-read';
import { useUsuals } from '../lib/use-usuals';
import { Sheet } from './Sheet';
import { Button } from './ui/button';

// Send to Target, on a phone only (docs/specs/0019, "The Send to Target sheet"): the message the items to get make, which the person
// sends to Target's app in ChatGPT. Open in ChatGPT opens it there with the text typed in; Share hands it to the phone's share sheet
// (where there is one); Copy copies it. The list is marked sent once Open has been pressed, a share has resolved (a share sheet closed
// without sharing marks nothing) or a copy has gone through. A message that is too long for the Open link offers no Open. `problem` is
// what a write that did not save said, in the change's place for this list; a second press while a mark is on its way does nothing.
export function SendToTargetSheet({
  items,
  busy: writing,
  problem,
  onMarkSent,
  onClose,
}: {
  items: ListItem[];
  busy: boolean;
  problem: string;
  onMarkSent: () => Promise<CardWriteOutcome>;
  onClose: () => void;
}) {
  // The message names the Household's Usuals, which the sheet reads itself. Until they are read nothing can be sent: a message made
  // before they land would leave them out, and one that cannot read them says so.
  const usuals = useUsuals();
  const busy = writing || usuals.data === null;
  const usualsSaid = usuals.data === null && usuals.state === 'failed' ? couldNotLoad('your usuals') : '';
  const message = targetMessage(items, usuals.data ?? []);
  const link = chatGptLink(message);
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;

  // The send reads what was drawn last, so a press sends the message and the busy state on screen.
  const latest = useRef({ message, busy, onMarkSent });
  useEffect(() => {
    latest.current = { message, busy, onMarkSent };
  });
  const [send] = useState(() =>
    createSend({
      message: () => latest.current.message,
      busy: () => latest.current.busy,
      share: canShare ? (data) => navigator.share(data) : undefined,
      copy: (text) => navigator.clipboard.writeText(text),
      mark: () => latest.current.onMarkSent(),
    }),
  );
  const [state, setState] = useState(send.state);
  useEffect(() => {
    setState(send.state());
    return send.subscribe(() => setState(send.state()));
  }, [send]);

  const said = state.said || problem || usualsSaid;

  return (
    <Sheet
      labelledBy="send-to-target-title"
      title="Send to Target"
      onClose={onClose}
      header={
        <header className="flex shrink-0 items-start justify-between gap-4">
          <h2 id="send-to-target-title" className="min-w-0 pt-1 font-display text-[30px] leading-9">
            Send to Target
          </h2>
          <Button variant="quiet" aria-label="Close" onClick={onClose} className="size-12 rounded-full p-0">
            <X aria-hidden className="size-[26px]" strokeWidth={2.2} />
          </Button>
        </header>
      }
      footer={<p className="shrink-0 text-[15px] text-muted-foreground">Check the cart in Target before you pay.</p>}
    >
      <div role="region" aria-label="The message for Target" tabIndex={0} className="max-h-64 overflow-y-auto rounded-2xl bg-muted p-4 text-[17px] leading-6 whitespace-pre-wrap">
        {message}
      </div>
      <div className="flex flex-col gap-3">
        {link !== null && (
          <Button asChild variant="primary" size="phone" className="w-full" aria-disabled={busy || undefined}>
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => {
                if (!send.open()) event.preventDefault();
              }}
            >
              Open in ChatGPT
            </a>
          </Button>
        )}
        {canShare && (
          <Button variant={link === null ? 'primary' : 'secondary'} size="phone" className="w-full" aria-disabled={busy || undefined} onClick={() => void send.share()}>
            Share
          </Button>
        )}
        <Button variant="secondary" size="phone" className="w-full" aria-disabled={busy || undefined} onClick={() => void send.copy()}>
          Copy
        </Button>
      </div>
      {/* Always drawn, so a screen reader announces "Copied" as it arrives rather than a region that was already filled. */}
      <p role="status" className="text-base">
        {state.copied && !said ? 'Copied' : ''}
      </p>
      {said && (
        <p role="alert" className="text-base">
          {said}
        </p>
      )}
    </Sheet>
  );
}
