import type { Session } from '@supabase/supabase-js';
import { useEffect, useRef, useState } from 'react';
import { Card, Problem } from './components/phone';
import { Button } from './components/ui/button';
import { isDeviceSession } from './lib/device';
import { signInWithGoogle } from './lib/household';
import { acceptHouseholdInvite, joinTokenOf } from './lib/household-invites';
import { joinViewOf, type JoinView } from './lib/join-view';
import { supabase } from './lib/supabase';
import { useDocumentTitle } from './lib/use-document-title';
import { useSystemMode } from './lib/use-mode';
import { writeFailureWords, type Said } from './lib/write-failure';

const JOIN_SAID = { failed: 'Could not join. Try again.', offline: 'No internet, so that did not join. Try again soon.' };

// The page, drawn from what it is told: the view, who is signed in, and what the buttons do. Nothing here reads the session or
// the network, so each view is rendered to markup as it is.
export function JoinCard({
  view,
  email,
  busy = false,
  problem,
  onSignIn,
  onJoin,
  onUseAnother,
}: {
  view: JoinView;
  email: string;
  busy?: boolean | undefined;
  problem?: Said | null | undefined;
  onSignIn: () => void;
  onJoin: () => void;
  onUseAnother: () => void;
}) {
  const useAnother = (
    <Button variant="secondary" size="phone" className="w-full" onClick={onUseAnother}>
      Use another Google account
    </Button>
  );
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-3 p-4">
      <h1 className="sr-only">Nidus</h1>
      <Card title="Join a household">
        {view === 'signed-out' ? (
          <>
            <p className="text-base leading-6">
              Someone has shared their Nidus household with you. Sign in with Google to see its calendar and add to it.
            </p>
            <Button variant="primary" size="phone" className="w-full" onClick={onSignIn}>
              Sign in with Google
            </Button>
          </>
        ) : view === 'signed-in' ? (
          <>
            <p className="text-base leading-6 break-words">You are signed in as {email}.</p>
            <Button variant="primary" size="phone" className="w-full" aria-disabled={busy || undefined} onClick={onJoin}>
              Join
            </Button>
            <Problem id="join-problem" problem={problem} />
            {useAnother}
          </>
        ) : view === 'other-household' ? (
          <>
            <p className="text-base leading-6 break-words">
              {email} already has its own household on Nidus. Use another Google account to join this one.
            </p>
            {useAnother}
          </>
        ) : (
          <p className="text-base leading-6">This invite link no longer works. Ask for a new one.</p>
        )}
      </Card>
    </main>
  );
}

// undefined: still reading the stored session. null: signed out. As in AdminApp.
function useSession(): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);
  return session;
}

// The page an invite link opens, at /join/<token>. Nothing is joined until Join is tapped: opening the link only asks which
// Google account it is for. Joined, or already in the Household, the page goes to Settings with `replace`, so that the token
// leaves the history.
export function JoinPage() {
  useSystemMode();
  useDocumentTitle('Join a household');
  const session = useSession();
  const token = joinTokenOf(window.location.pathname);
  // What the database said of this token for this account, kept with the account: another account starts again.
  const [refused, setRefused] = useState<{ userId: string; view: 'expired' | 'other-household' } | null>(null);
  const [problem, setProblem] = useState<Said | null>(null);
  // One write at a time: the ref is the guard, the state is what is drawn.
  const working = useRef(false);
  const [busy, setBusy] = useState(false);

  if (session === undefined && token !== null) return null;

  const signedIn = session && !isDeviceSession(session) ? session : null;
  const userId = signedIn?.user.id;
  const email = signedIn?.user.email ?? 'this Google account';
  const view: JoinView =
    token === null ? 'expired' : refused && refused.userId === userId ? refused.view : signedIn ? 'signed-in' : 'signed-out';

  async function join() {
    if (!token || !userId || working.current) return;
    working.current = true;
    setBusy(true);
    try {
      const next = joinViewOf(await acceptHouseholdInvite(token));
      if (next === null) {
        // Navigating away: the page stays as it is, busy, until it goes.
        window.location.replace('/settings');
        return;
      }
      if (next === 'expired' || next === 'other-household') setRefused({ userId, view: next });
    } catch (error) {
      setProblem({ words: writeFailureWords(error, { offline: false, said: JOIN_SAID }), n: (problem?.n ?? 0) + 1 });
    }
    working.current = false;
    setBusy(false);
  }

  return (
    <JoinCard
      view={view}
      email={email}
      busy={busy}
      problem={problem}
      onSignIn={() => void signInWithGoogle(`/join/${token}`)}
      onJoin={() => void join()}
      onUseAnother={() => {
        setRefused(null);
        setProblem(null);
        void supabase.auth.signOut();
      }}
    />
  );
}
