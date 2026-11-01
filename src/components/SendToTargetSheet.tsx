import { X } from 'lucide-react';
import { useState } from 'react';
import { chatGptLink, targetMessage } from '../lib/send-to-target';
import type { ListItem } from '../lib/shared-lists';
import { Sheet } from './Sheet';
import { Button } from './ui/button';

// Send to Target, on a phone only (docs/specs/0019, "The Send to Target sheet"): the message the items to get make, which the person
// sends to Target's app in ChatGPT. Open in ChatGPT opens it there with the text typed in; Share hands it to the phone's share sheet
// (where there is one); Copy copies it. The list is marked sent once Open has been pressed, a share has resolved (a share sheet closed
// without sharing marks nothing) or a copy has gone through. A message that is too long for the Open link offers no Open.
export function SendToTargetSheet({ items, onMarkSent, onClose }: { items: ListItem[]; onMarkSent: () => Promise<string>; onClose: () => void }) {
  // The Usuals join the message in ticket 4; until then there are none.
  const message = targetMessage(items, []);
  const link = chatGptLink(message);
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState('');
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;

  // Marks the list sent; a problem is said here, in the sheet, where the person is looking.
  async function sent() {
    setProblem(await onMarkSent());
  }

  async function share() {
    try {
      await navigator.share({ text: message });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setProblem("Couldn't share. Try Copy.");
      return;
    }
    await sent();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
    } catch {
      setCopied(false);
      setProblem("Couldn't copy. Select the message and copy it by hand.");
      return;
    }
    setCopied(true);
    await sent();
  }

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
          <Button asChild variant="primary" size="phone" className="w-full">
            <a href={link} target="_blank" rel="noopener noreferrer" onClick={() => void sent()}>
              Open in ChatGPT
            </a>
          </Button>
        )}
        {canShare && (
          <Button variant={link === null ? 'primary' : 'secondary'} size="phone" className="w-full" onClick={() => void share()}>
            Share
          </Button>
        )}
        <Button variant="secondary" size="phone" className="w-full" onClick={() => void copy()}>
          Copy
        </Button>
      </div>
      {/* Always drawn, so a screen reader announces "Copied" as it arrives rather than a region that was already filled. */}
      <p role="status" className="text-base">
        {copied && !problem ? 'Copied' : ''}
      </p>
      {problem && (
        <p role="alert" className="text-base">
          {problem}
        </p>
      )}
    </Sheet>
  );
}
