import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isDeviceSession, requestPairingCode, touchDevice, type PairingCode } from './lib/device';
import { formatCountdown } from './lib/device-format';
import { FiveDayCalendar } from './components/FiveDayCalendar';
import { householdViewAfter, loadHousehold, type Household, type HouseholdView } from './lib/household';
import { supabase } from './lib/supabase';
import { RoutinesRail } from './RoutinesPage';
import { PinnedListRail, WallListsScreen } from './SharedListsPage';

// A revoked tablet learns of it on the next heartbeat, so this is the upper bound.
const HEARTBEAT_MS = 30_000;
// While showing a code, ask often so a claim is noticed within seconds.
const CLAIM_POLL_MS = 3_000;
const RETRY_MS = 5_000;
// Same cadence as the Routines rail, so a changed Household Timezone reaches the wall within a read.
const HOUSEHOLD_REFRESH_MS = 30_000;
// After a failed Household read, retry sooner.
const HOUSEHOLD_RETRY_MS = 5_000;

type WallState = { kind: 'connecting' } | { kind: 'unpaired'; pairing: PairingCode } | { kind: 'paired' };

// One anonymous sign-in at a time, so a remount (StrictMode) never mints two sessions.
let pendingSignIn: ReturnType<typeof supabase.auth.signInAnonymously> | undefined;

async function ensureSession(): Promise<Session> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session;
  pendingSignIn ??= supabase.auth.signInAnonymously().finally(() => {
    pendingSignIn = undefined;
  });
  const { data: signedIn, error } = await pendingSignIn;
  if (error || !signedIn.session) throw error ?? new Error('anonymous sign-in returned no session');
  return signedIn.session;
}

// The wall: the tablet's only screen. Unpaired, it shows a Pairing Code; paired,
// the home screen shell. It never offers a way into administration.
export function WallPage() {
  const [state, setState] = useState<WallState>({ kind: 'connecting' });

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pairing: PairingCode | undefined;

    async function step(): Promise<number> {
      const session = await ensureSession();
      if (!isDeviceSession(session)) {
        // A Household Account landed on the wall (the Google sign-in redirect): send it to settings.
        window.location.replace('/settings');
        return HEARTBEAT_MS;
      }
      if (await touchDevice()) {
        pairing = undefined;
        if (live) setState((prev) => (prev.kind === 'paired' ? prev : { kind: 'paired' }));
        return HEARTBEAT_MS;
      }
      // Never paired, or revoked: show a code that still has time on it.
      if (!pairing || pairing.expiresAt.getTime() <= Date.now()) pairing = await requestPairingCode();
      const shown = pairing;
      if (live) setState((prev) => (prev.kind === 'unpaired' && prev.pairing === shown ? prev : { kind: 'unpaired', pairing: shown }));
      return CLAIM_POLL_MS;
    }

    async function loop() {
      let delay = RETRY_MS;
      try {
        delay = await step();
      } catch {
        // Offline or the server is restarting: keep what the wall shows and try again.
      }
      if (live) timer = setTimeout(() => void loop(), delay);
    }

    void loop();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, []);

  if (state.kind === 'paired') return <HomeShell />;
  if (state.kind === 'unpaired') return <PairingScreen pairing={state.pairing} />;
  return (
    <main className="flex min-h-svh items-center justify-center p-8">
      <p role="status" className="text-2xl">
        Connecting
      </p>
    </main>
  );
}

function PairingScreen({ pairing }: { pairing: PairingCode }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const remaining = pairing.expiresAt.getTime() - now;

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-8 p-8 text-center">
      <h1 className="text-4xl font-semibold">Pair this tablet</h1>
      <p className="max-w-2xl text-2xl">
        On your phone, open {window.location.origin}/settings, sign in, and enter this code.
      </p>
      <p className="font-mono text-9xl font-bold tracking-[0.2em]">
        {pairing.code}
      </p>
      <p role="timer" className="text-2xl">
        {remaining > 0 ? `Code expires in ${formatCountdown(remaining)}` : 'Getting a new code'}
      </p>
    </main>
  );
}

// The landscape home screen: the five-day calendar on the left; the right rail
// holds today's Routines above the pinned Shared List, and the other lists open from the header.
function HomeShell() {
  // The Household Timezone decides which day the Routines rail shows; none until it is read.
  const [view, setView] = useState<HouseholdView>({ household: null, failed: false });
  const [listsOpen, setListsOpen] = useState(false);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function read() {
      let outcome: { household: Household } | { failed: true };
      try {
        outcome = { household: await loadHousehold() };
      } catch {
        outcome = { failed: true };
      }
      if (!live) return;
      setView((prev) => householdViewAfter(prev, outcome));
      // After a failed read retry sooner, so the rail appears once the connection is back.
      timer = setTimeout(() => void read(), 'household' in outcome ? HOUSEHOLD_REFRESH_MS : HOUSEHOLD_RETRY_MS);
    }

    void read();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, []);
  const name = view.household?.name ?? '';
  const timezone = view.household?.timezone ?? null;

  return (
    <main className="grid h-svh grid-rows-[auto_minmax(0,1fr)] gap-6 p-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold">{name}</h1>
        <button type="button" className="min-h-12 rounded-lg border border-border px-6 text-lg font-medium" onClick={() => setListsOpen(true)}>
          Lists
        </button>
      </header>
      <div className="grid min-h-0 grid-cols-[1fr_24rem] gap-6">
        {timezone ? <FiveDayCalendar timezone={timezone} /> : <section aria-label="Calendar" className="rounded-xl border border-border" />}
        <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-6">
          {timezone ? (
            <RoutinesRail timezone={timezone} />
          ) : (
            <aside aria-label="Today's Routines" className="rounded-xl border border-border p-4">
              {view.failed && (
                <p role="alert" className="text-base">
                  Could not load Routines. Check your connection.
                </p>
              )}
            </aside>
          )}
          <PinnedListRail />
        </div>
      </div>
      {listsOpen && <WallListsScreen onClose={() => setListsOpen(false)} />}
    </main>
  );
}
