import { Calendar, ChevronRight, CircleCheck, House, List, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { CalendarsPage } from './CalendarsPage';
import { RoutinesPage } from './RoutinesPage';
import { SettingsPage } from './SettingsPage';
import { SharedListsPage } from './SharedListsPage';
import { ChangeFeedProvider } from './components/ChangeFeedProvider';
import { ConnectionBadge } from './components/ConnectionBadge';
import { cardClass } from './components/phone';
import { StatusLineProvider } from './components/StatusLine';
import { Button } from './components/ui/button';
import { isDeviceSession } from './lib/device';
import { ensureHousehold, loadHousehold, signInWithGoogle } from './lib/household';
import { turnOffBeforeSignOut } from './lib/push';
import { SETTINGS_TABS, settingsLabelOf, settingsPathNow, settingsTabOf, type SettingsTab } from './lib/settings-tabs';
import { supabase } from './lib/supabase';
import { useSyncedRead } from './lib/synced-read';
import { useDocumentTitle } from './lib/use-document-title';
import { useSystemMode } from './lib/use-mode';

// The icon over each tab's word.
const TAB_ICONS: Record<SettingsTab, LucideIcon> = { household: House, calendars: Calendar, routines: CircleCheck, lists: List };

// The Household is read again when its row changes: its name, its time zone and how the Wall looks.
const HOUSEHOLD_TABLES = ['households'] as const;
const COULD_NOT_LOAD = 'Could not load your household. Reload to try again.';

// undefined: still reading the stored session. null: signed out.
function useSession(): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);
  return session;
}

// Administration, phone only: gated on a Household Account session. A Device (anonymous session) gets a dead end, never a
// screen that can change anything. Signed in, the phone has a top bar (the Household's name, and the way back to the Wall) and
// four tabs, Household, Calendars, Routines and Lists, which stay in view while a page scrolls under them.
export function AdminApp() {
  // The phone's pages follow the phone's own light or dark, never the Wall's.
  useSystemMode();
  const session = useSession();
  // The Household Account whose Household is made and can be read: set once ensureHousehold has run for that user.
  const [ready, setReady] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const userId = session?.user.id;
  const device = session ? isDeviceSession(session) : false;
  const tab = settingsTabOf(window.location.pathname);

  // Each page says where it is in the document's title, from the first paint: the sign-in and the dead end have their own.
  // A signed-in page names itself once its Household is there (Administration below); until then it is Settings.
  useDocumentTitle(session === null ? 'Sign in' : device ? 'Settings are for phones' : 'Settings');

  // The tabs stay at the top while a page scrolls under them, so a control that is scrolled to for the keyboard must stop short of them:
  // 5 rem is the bar (76 px) and a little air.
  useEffect(() => {
    document.documentElement.style.scrollPaddingTop = '5rem';
    return () => {
      document.documentElement.style.scrollPaddingTop = '';
    };
  }, []);

  // The events added in Nidus were at /settings/events: that address now is /settings/calendars, and the address bar says so.
  useEffect(() => {
    const { pathname, search, hash } = window.location;
    const now = settingsPathNow(pathname);
    if (now !== pathname) window.history.replaceState(window.history.state, '', now + search + hash);
  }, []);

  useEffect(() => {
    if (!session || device) return;
    let live = true;
    ensureHousehold(session)
      .then(() => live && setReady(session.user.id))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
    // Re-run per signed-in user, not per token refresh.
  }, [userId, device]);

  if (session === undefined) return null;

  if (session === null) {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-6 p-4">
        <h1 className="font-display text-[30px] leading-9">Nidus</h1>
        <Button variant="primary" size="phone" onClick={() => void signInWithGoogle()}>
          Sign in with Google
        </Button>
      </main>
    );
  }

  if (device) {
    return (
      <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center p-4">
        <div className={`${cardClass} items-start`}>
          <h1 className="font-display text-[26px] leading-8">Settings are for phones</h1>
          <p className="text-base leading-6">This tablet shows the Wall and cannot change anything. To manage the household, sign in on a phone.</p>
          <Button asChild variant="secondary" size="phone">
            <a href="/">Back to the Wall</a>
          </Button>
        </div>
      </main>
    );
  }

  if (failed) return <main className="p-4 text-base">{COULD_NOT_LOAD}</main>;
  if (ready !== userId) return null;

  return (
    <ChangeFeedProvider>
      <StatusLineProvider>
        <Administration
          userId={session.user.id}
          tab={tab}
          onSignOut={() => {
            setReady(null);
            // This phone's notifications end first, while the session can still delete their row; a failure never holds sign-out.
            void turnOffBeforeSignOut(supabase).then(() => supabase.auth.signOut());
          }}
        />
      </StatusLineProvider>
    </ChangeFeedProvider>
  );
}

// The signed-in screens: the top bar, the tabs and the page, drawn from the Household as the synced read holds it now. The read is made
// here, inside the change feed, so that a change to the Household is heard at once and every screen follows it.
function Administration({ userId, tab, onSignOut }: { userId: string; tab: SettingsTab; onSignOut: () => void }) {
  const read = useSyncedRead(loadHousehold, HOUSEHOLD_TABLES, userId);
  const household = read.data;
  // Settings until the Household is there, so a first read that fails leaves the title as it says: Settings.
  useDocumentTitle(household ? settingsLabelOf(tab) : 'Settings');
  // Only a first read that fails says it could not load; a later failure keeps what is shown.
  if (read.state === 'failed') return <main className="p-4 text-base">{COULD_NOT_LOAD}</main>;
  if (!household) return null;

  return (
    <>
      <header className="mx-auto flex h-16 w-full max-w-md items-center justify-between gap-3 px-4">
        <p className="min-w-0 truncate font-display text-2xl leading-[30px]">{household.name}</p>
        <Button asChild variant="quiet" className="h-12 shrink-0 gap-1 rounded-2xl pr-0 pl-3 text-[15px] font-medium">
          <a href="/">
            Open the Wall
            <ChevronRight aria-hidden className="size-5" strokeWidth={2.2} />
          </a>
        </Button>
      </header>
      <div className="mx-auto flex w-full max-w-md justify-end px-4">
        <ConnectionBadge />
      </div>
      <nav aria-label="Settings sections" className="sticky top-0 z-10 bg-background">
        {/* Four equal columns while each word fits its column, and each tab as wide as its word needs when it does not (at 320 px
            "Household" in 600 is 74 px and an equal column is 70): the label is always inside the tab and its ring. 4 px above, for
            the ring a focused tab draws past its edge when the bar is stuck at the top; below 380 px the bar gives up 8 px at each
            side, keeping its 8 px between tabs. */}
        <div className="mx-auto grid w-full max-w-md grid-cols-[repeat(4,minmax(max-content,1fr))] gap-2 px-4 pt-1 pb-2 max-[380px]:px-2">
          {SETTINGS_TABS.map(({ tab: id, path, label }) => {
            const Icon = TAB_ICONS[id];
            return (
              <Button key={id} asChild variant="quiet" className="h-16 flex-col gap-1 rounded-2xl px-1 text-sm font-medium">
                <a href={path} aria-current={id === tab ? 'page' : undefined}>
                  <Icon aria-hidden className="size-6" />
                  <span>{label}</span>
                </a>
              </Button>
            );
          })}
        </div>
      </nav>
      {tab === 'lists' ? (
        <SharedListsPage household={household} />
      ) : tab === 'routines' ? (
        <RoutinesPage household={household} />
      ) : tab === 'calendars' ? (
        <CalendarsPage household={household} />
      ) : (
        <SettingsPage household={household} read={read} userId={userId} onSignOut={onSignOut} />
      )}
    </>
  );
}
