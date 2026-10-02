import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { StatusLineContext, createStatusLine } from '../lib/status-line';

// Gives the Wall its status line: any component under it can say a line (useStatusLine), and it is drawn here,
// over the foot of the screen. It overlays, so it takes no room from the screen behind it and lets a tap through.
// The region is always on the page and only its line changes, so a screen reader announces each new line, politely. The
// line is keyed on how many times anything has been said, so the same words said twice are two lines, and are announced
// twice: a screen reader announces a change, and the same text set again is none.
export function StatusLineProvider({ children }: { children: ReactNode }) {
  const [status] = useState(createStatusLine);
  const line = useSyncExternalStore(status.subscribe, status.line);
  const said = useSyncExternalStore(status.subscribe, status.count);
  useEffect(() => () => status.dispose(), [status]);

  return (
    <StatusLineContext.Provider value={status.say}>
      {children}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-4 z-30 flex justify-center">
        {line && (
          <p key={said} className="max-w-xl rounded-2xl bg-foreground px-5 py-3 text-center text-base font-medium text-background">
            {line}
          </p>
        )}
      </div>
    </StatusLineContext.Provider>
  );
}
