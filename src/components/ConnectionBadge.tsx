import { WifiOff } from 'lucide-react';
import { useConnection } from '../lib/change-feed';
import { PHONE_OFFLINE_WORD, PHONE_PILL } from './phone-pill';

// Shown only while the screen cannot hear the server. What it last read stays on screen; it
// reconnects by itself, so there is nothing to tap. Never colour alone: an icon and words.
// The live region is always on the page and only its content changes, so a screen reader
// announces the loss when it happens.
// `compact` is for the Wall's header, which has no room for the sentence: the icon and "Offline" are
// drawn as a small pill, on one line that never shrinks, and the rest of the sentence is for a screen reader
// only, so what is announced is the same.
//
// `phone` is the phone's header's form: a smaller pill whose word, "Offline", is drawn on every phone but one under 360 px wide that
// has a second pill beside it (src/components/phone-pill.ts), and is always in the sentence a screen reader hears.
export function ConnectionBadge({ compact = false, phone = false }: { compact?: boolean; phone?: boolean }) {
  const offline = useConnection() === 'offline';
  const shown = phone
    ? PHONE_PILL
    : compact
    ? 'inline-flex h-9 shrink-0 items-center gap-2 rounded-full bg-muted px-3.5 text-sm font-medium whitespace-nowrap'
    : 'inline-flex items-center gap-2 rounded-2xl bg-muted px-4 py-2 text-base';
  return (
    <p role="status" data-pill={offline && phone ? '' : undefined} className={offline ? shown : 'sr-only'}>
      {offline && (
        <>
          <WifiOff aria-hidden className="size-[18px] shrink-0" />
          {phone ? (
            <>
              <span aria-hidden className={PHONE_OFFLINE_WORD}>
                Offline
              </span>
              <span className="sr-only">Offline. Showing the last update.</span>
            </>
          ) : compact ? (
            <>
              Offline<span className="sr-only">. Showing the last update.</span>
            </>
          ) : (
            'Offline. Showing the last update.'
          )}
        </>
      )}
    </p>
  );
}
