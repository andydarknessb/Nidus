import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { SettingsPage } from './SettingsPage';
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

export function App() {
  const session = useSession();
  const [household, setHousehold] = useState<Household | null>(null);
  const [failed, setFailed] = useState(false);
  const userId = session?.user.id;

  useEffect(() => {
    if (!session) return;
    let live = true;
    ensureHousehold(session)
      .then((found) => live && setHousehold(found))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
    // Re-run per signed-in user, not per token refresh.
  }, [userId]);

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
