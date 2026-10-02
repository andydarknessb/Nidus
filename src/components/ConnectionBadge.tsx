import { WifiOff } from 'lucide-react';
import { useConnection } from '../lib/change-feed';

// Shown only while the screen cannot hear the server. What it last read stays on screen; it
// reconnects by itself, so there is nothing to tap. Never colour alone: an icon and words.
// The live region is always on the page and only its content changes, so a screen reader
// announces the loss when it happens.
// `compact` is for the Wall's header, which has no room for the sentence: the icon and "Offline" are
// drawn as a small pill, on one line that never shrinks, and the rest of the sentence is for a screen reader
// only, so what is announced is the same.
export function ConnectionBadge({ compact = false }: { compact?: boolean }) {
  const offline = useConnection() === 'offline';
  const shown = compact
    ? 'inline-flex h-9 shrink-0 items-center gap-2 rounded-full bg-muted px-3.5 text-sm font-medium whitespace-nowrap'
    : 'inline-flex items-center gap-2 rounded-2xl bg-muted px-4 py-2 text-base';
  return (
    <p role="status" className={offline ? shown : 'sr-only'}>
      {offline && (
        <>
          <WifiOff aria-hidden className="size-[18px] shrink-0" />
          {compact ? (
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
