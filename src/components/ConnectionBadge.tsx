import { WifiOff } from 'lucide-react';
import { useConnection } from '../lib/change-feed';

// Shown only while the screen cannot hear the server. What it last read stays on screen; it
// reconnects by itself, so there is nothing to tap. Never colour alone: an icon and words.
// The live region is always on the page and only its content changes, so a screen reader
// announces the loss when it happens.
export function ConnectionBadge() {
  const offline = useConnection() === 'offline';
  return (
    <p role="status" className={offline ? 'inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-lg' : 'sr-only'}>
      {offline && (
        <>
          <WifiOff aria-hidden className="size-5 shrink-0" />
          Offline. Showing the last update.
        </>
      )}
    </p>
  );
}
