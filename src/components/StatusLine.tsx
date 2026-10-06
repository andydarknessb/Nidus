import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { StatusLineContext, createStatusLine } from '../lib/status-line';

// Gives a screen its status line, the Wall's and the phone's pages' alike: any component under it can say a line (useStatusLine), and it is drawn here,
// over the foot of the screen. It overlays, so it takes no room from the screen behind it and lets a tap through.
// The region is always on the page and only its line changes, so a screen reader announces each new line, politely. The
// line is keyed on how many times anything has been said, so the same words said twice are two lines, and are announced
// twice: a screen reader announces a change, and the same text set again is none. A line that wraps (a phone's narrow screen) is
// balanced (text-balance), so it never leaves one word alone on its last line.
//
// The screen is held in a wrapper that has no box of its own, which is what a sheet makes inert while it is open (BEHIND_SHEETS,
// lib/inert-behind.ts), and the line is beside it, not in it: a line said as a sheet closes (an event saved, a meal planned) is
// announced, not lost to a page that is still inert when it arrives.
export function StatusLineProvider({ children }: { children: ReactNode }) {
  const [status] = useState(createStatusLine);
  // (The third argument is what a render to markup reads, which a test does: the same.)
  const line = useSyncExternalStore(status.subscribe, status.line, status.line);
  const said = useSyncExternalStore(status.subscribe, status.count, status.count);
  useEffect(() => () => status.dispose(), [status]);

  return (
    <StatusLineContext.Provider value={status.say}>
      <div data-behind-sheets="" className="contents">
        {children}
      </div>
      {/* --status-foot is how far up the screen its own foot is: the phone's Wall sets it to clear its tab bar and Add event (PhoneShell). */}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-[var(--status-foot,1rem)] z-30 flex justify-center">
        {line && (
          <p key={said} className="max-w-xl rounded-2xl bg-foreground px-5 py-3 text-center text-base font-medium text-balance text-background">
            {line}
          </p>
        )}
      </div>
    </StatusLineContext.Provider>
  );
}
