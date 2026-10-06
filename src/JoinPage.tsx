import type { Session } from '@supabase/supabase-js';
import { useEffect, useRef, useState } from 'react';
import { Problem, cardClass } from './components/phone';
import { Button } from './components/ui/button';
import { signInToJoin } from './lib/household';
import { acceptHouseholdInvite, isHouseholdAccount, joinTokenOf } from './lib/household-invites';
import { joinViewFor, joinViewOf, offersSettings, type JoinView, type Refusal } from './lib/join-view';
import { supabase } from './lib/supabase';
import { useDocumentTitle } from './lib/use-document-title';
import { useSystemMode } from './lib/use-mode';
import { writeFailureWords, type Said } from './lib/write-failure';

const JOIN_SAID = { failed: 'Could not join. Try again.', offline: 'No internet, so that did not join. Try again soon.' };
// Signing in makes no request from this page (the implicit flow leaves for Google), so there is no offline case to word.
const SIGN_IN_FAILED = 'Could not sign in. Try again.';

// Where a refusal is said and where focus goes when it is: the Join button that had it is gone.
const OUTCOME_ID = 'join-outcome';

// The page, drawn from what it is told: the view, who is signed in, and what the buttons do. Nothing here reads the session or
// the network, so each view is rendered to markup as it is. A single card on the page, as the tablet's dead end in Settings is.
export function JoinCard({
  view,
  email,
  member = false,
  busy = false,
  problem,
  onSignIn,
  onJoin,
  onUseAnother,
  onOpenSettings,
}: {
  view: JoinView;
  // The signed-in Google account's address; null when there is none to say.
  email: string | null;
  // The account is already a Household Account: a dead link then also offers Settings.
  member?: boolean | undefined;
  busy?: boolean | undefined;
  problem?: Said | null | undefined;
  onSignIn: () => void;
  onJoin: () => void;
  onUseAnother: () => void;
  onOpenSettings: () => void;
}) {
  // Switching account while a join is on its way would sign out under it, so it waits like Join does.
  const useAnother = (
    <Button
      variant="secondary"
      size="phone"
      className="w-full"
      aria-disabled={busy || undefined}
      onClick={() => {
        if (!busy) onUseAnother();
      }}
    >
      Use another Google account
    </Button>
  );
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center p-4">
      <div className={cardClass}>
        <h1 className="font-display text-[26px] leading-8">Join a household</h1>
        {view === 'signed-out' ? (
          <>
            <p className="text-base leading-6">
              Someone has shared their Nidus household with you. Sign in with Google to see its calendar and add to it.
            </p>
            <Button variant="primary" size="phone" className="w-full" onClick={onSignIn}>
              Sign in with Google
            </Button>
            <Problem id="join-problem" problem={problem} />
          </>
        ) : view === 'signed-in' ? (
          <>
            <p className="text-base leading-6 break-words">You are signed in as {email ?? 'this Google account'}.</p>
            <Button variant="primary" size="phone" className="w-full" aria-disabled={busy || undefined} onClick={onJoin}>
              Join
            </Button>
            <Problem id="join-problem" problem={problem} />
            {useAnother}
          </>
        ) : view === 'other-household' ? (
          <>
            <p id={OUTCOME_ID} role="status" tabIndex={-1} className="text-base leading-6 break-words">
              {email ?? 'This Google account'} already has its own household on Nidus. Use another Google account to join this one.
            </p>
            {useAnother}
          </>
        ) : (
          <>
            <p id={OUTCOME_ID} role="status" tabIndex={-1} className="text-base leading-6">
              This invite link no longer works. Ask for a new one.
            </p>
            {offersSettings(view, member) && (
              <Button variant="primary" size="phone" className="w-full" onClick={onOpenSettings}>
                Open Settings
              </Button>
            )}
          </>
        )}
      </div>
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
  const [refused, setRefused] = useState<Refusal | null>(null);
  const [problem, setProblem] = useState<Said | null>(null);
  // One write at a time: the ref is the guard, the state is what is drawn.
  const working = useRef(false);
  const [busy, setBusy] = useState(false);

  // A refusal replaces the question the person was on, and with it the button they pressed: its words are read out and have focus.
  useEffect(() => {
    if (refused) document.getElementById(OUTCOME_ID)?.focus();
  }, [refused]);

  if (session === undefined && token !== null) return null;

  const view = joinViewFor({ token, session: session ?? null, refused });
  const userId = view === 'signed-in' ? session?.user.id : undefined;
  const email = session?.user.email ?? null;

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
      if (next === 'other-household') setRefused({ userId, view: next, member: false });
      else if (next === 'expired') {
        // A spent link opened again by someone who joined by it: say so, and offer Settings if the account is in a Household.
        const member = await isHouseholdAccount().catch(() => false);
        setRefused({ userId, view: next, member });
      }
    } catch (error) {
      setProblem({ words: writeFailureWords(error, { offline: false, said: JOIN_SAID }), n: (problem?.n ?? 0) + 1 });
    }
    working.current = false;
    setBusy(false);
  }

  async function signIn() {
    if (!token) return;
    try {
      await signInToJoin(token);
    } catch {
      setProblem({ words: SIGN_IN_FAILED, n: (problem?.n ?? 0) + 1 });
    }
  }

  return (
    <JoinCard
      view={view}
      email={email}
      member={refused !== null && refused.userId === session?.user.id && refused.member}
      busy={busy}
      problem={problem}
      onSignIn={() => void signIn()}
      onJoin={() => void join()}
      onOpenSettings={() => window.location.replace('/settings')}
      onUseAnother={() => {
        setRefused(null);
        setProblem(null);
        void supabase.auth.signOut({ scope: 'local' });
      }}
    />
  );
}
