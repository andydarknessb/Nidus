import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { SettingsPage } from './SettingsPage';
import { isDeviceSession } from './lib/device';
import { ensureHousehold, signInWithGoogle, type Household } from './lib/household';
import { supabase } from './lib/supabase';

const action = 'min-h-12 rounded-lg bg-primary px-6 text-base font-medium text-primary-foreground';

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

// Administration, phone only: gated on a Household Account session. A Device
// (anonymous session) gets a dead end, never a screen that can change anything.
export function AdminApp() {
  const session = useSession();
  const [household, setHousehold] = useState<Household | null>(null);
  const [failed, setFailed] = useState(false);
  const userId = session?.user.id;
  const device = session ? isDeviceSession(session) : false;

  useEffect(() => {
    if (!session || device) return;
    let live = true;
    ensureHousehold(session)
      .then((found) => live && setHousehold(found))
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
        <h1 className="text-4xl font-bold tracking-tight">Nidus</h1>
        <button type="button" className={action} onClick={() => void signInWithGoogle()}>
          Sign in with Google
        </button>
      </main>
    );
  }

  if (device) {
    return (
      <main className="mx-auto flex min-h-svh max-w-md flex-col items-start justify-center gap-6 p-4">
        <h1 className="text-2xl font-semibold">Settings are for phones</h1>
        <p className="text-base">This tablet is a Device. Manage the Household by signing in on a phone.</p>
        <a href="/" className="inline-flex min-h-12 items-center rounded-lg border border-border px-4 text-base font-medium">
          Back to the wall
        </a>
      </main>
    );
  }

  if (failed) return <main className="p-4 text-base">Could not load your Household. Reload to try again.</main>;
  if (!household) return null;

  return (
    <SettingsPage
      household={household}
      onSaved={setHousehold}
      onSignOut={() => {
        setHousehold(null);
        void supabase.auth.signOut();
      }}
    />
  );
}
