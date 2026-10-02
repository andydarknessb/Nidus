import { WifiOff } from 'lucide-react';
import { useConnection } from '../lib/change-feed';

// Shown only while the screen cannot hear the server. What it last read stays on screen; it
// reconnects by itself, so there is nothing to tap. Never colour alone: an icon and words.
// The live region is always on the page and only its content changes, so a screen reader
// announces the loss when it happens.
// `compact` is for the Wall's header, which has no room for the sentence: the icon and "Offline" are
// drawn, on one line that never shrinks, and the rest of the sentence is for a screen reader only, so
// what is announced is the same.
export function ConnectionBadge({ compact = false }: { compact?: boolean }) {
  const offline = useConnection() === 'offline';
  const shown = `inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-lg${compact ? ' shrink-0 whitespace-nowrap' : ''}`;
  return (
    <p role="status" className={offline ? shown : 'sr-only'}>
      {offline && (
        <>
          <WifiOff aria-hidden className="size-5 shrink-0" />
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
