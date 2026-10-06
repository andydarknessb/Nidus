import { ChevronDown, ChevronRight, Plus, UserRound } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, Confirm, Field, Problem, buttonHalf, buttonRow, fieldClass, helpClass } from '@/components/phone';
import { Button } from '@/components/ui/button';
import { useConnection } from '@/lib/change-feed';
import { formatDate, formatDateWithYear } from '@/lib/calendar-occurrences';
import {
  cancelHouseholdInvite,
  createHouseholdInvite,
  inviteLink,
  listHouseholdAccounts,
  readHouseholdInvite,
  removeHouseholdAccount,
  type HouseholdAccountRow,
  type HouseholdInvite,
} from '@/lib/household-invites';
import { CANCEL_SAID, MAKE_SAID, inviteViewOf, sharePayload, type InviteView } from '@/lib/household-accounts';
import { useWriteProblem, type WriteProblem } from '@/lib/use-write-problem';

// What the status line says: nothing, or what the last tap did.
export type InviteStatus = 'idle' | 'copied' | 'cancelled';

const statusWords: Record<InviteStatus, string> = { idle: '', copied: 'Copied', cancelled: 'Invite cancelled.' };

const COPY_FAILED = 'Could not copy. Press and hold the link to copy it.';
const SHARE_FAILED = 'Could not share. Use Copy instead.';

// Where a write that failed says so: under the invite's buttons, or in the question about removing someone.
const INVITE = 'invite';
const removePlace = (id: string) => `remove-${id}`;
const problemId = (place: string) => `problem-${place}`;

// The one control focus goes to once the one it was on is gone: Invite someone, Copy or Make a new link, whichever the invite shows.
const INVITE_MAIN = 'invite-main';
const removeId = (id: string) => `remove-account-${id}`;

const rowClass = 'h-14 w-full justify-start gap-3 rounded-[14px] px-3.5 text-left font-medium';

// An account's two lines: the email ("You" beside it on the signed-in one's own), and since when.
function AccountWords({ email, you, since }: { email: string; you: boolean; since: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="flex items-baseline gap-2">
        <span className="truncate text-[17px] leading-[22px] font-medium">{email}</span>
        {you && <span className="shrink-0 text-sm leading-[18px] font-semibold">You</span>}
      </span>
      <span className="text-sm leading-[18px] font-normal text-muted-foreground">Since {since}</span>
    </span>
  );
}

type ViewProps = {
  // null until the first read lands.
  accounts: HouseholdAccountRow[] | null;
  invite: InviteView | null;
  // The signed-in account's id, whose row is "You" and offers no Remove, and the Household Timezone every date is written in.
  userId: string;
  timezone: string;
  // Whether the phone can share (`navigator.share` exists): Share is not drawn when it cannot.
  canShare: boolean;
  // The account whose row is open, and whether it is being asked to be sure.
  open: { id: string; confirming: boolean } | null;
  busy: boolean;
  status: InviteStatus;
  loadProblem: string | null;
  problemAt: (place: string) => WriteProblem | null;
  onOpen: (id: string | null) => void;
  onAskRemove: (id: string) => void;
  onCancelRemove: (id: string) => void;
  onRemove: (id: string) => void;
  onMakeInvite: () => void;
  onCancelInvite: () => void;
  onShare: () => void;
  onCopy: () => void;
};

// What the section draws, from what it is told: each of its states is rendered in tests/household-accounts-section.test.ts.
export function HouseholdAccountsView(props: ViewProps) {
  const { accounts, invite, userId, timezone, canShare, open, busy, status, loadProblem, problemAt } = props;
  const date = (when: Date) => formatDate(when.getTime(), timezone);
  // A tap while a write is on its way does nothing; the button says so with `aria-disabled`, never `disabled`.
  const guarded = (action: () => void) => () => {
    if (!busy) action();
  };

  return (
    <Card title="Who can sign in">
      {loadProblem && (
        <p role="alert" className="text-base">
          {loadProblem}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {accounts?.map((account) => {
          const id = account.authUserId;
          const since = formatDateWithYear(account.createdAt.getTime(), timezone);
          if (id === userId) {
            return (
              <li key={id} className={`${rowClass} flex items-center bg-muted`}>
                <UserRound aria-hidden className="size-[22px] shrink-0" />
                <AccountWords email={account.email} you since={since} />
              </li>
            );
          }
          const expanded = open?.id === id;
          return (
            <li key={id} className="flex flex-col gap-4">
              <Button id={`account-${id}`} variant="secondary" aria-expanded={expanded} className={rowClass} onClick={() => props.onOpen(expanded ? null : id)}>
                <UserRound aria-hidden className="size-[22px]" />
                <AccountWords email={account.email} you={false} since={since} />
                {expanded ? <ChevronDown aria-hidden className="size-[22px] text-muted-foreground" /> : <ChevronRight aria-hidden className="size-[22px] text-muted-foreground" />}
              </Button>
              {expanded &&
                (open.confirming ? (
                  <Confirm
                    title={`Remove ${account.email}?`}
                    words="They will no longer be able to open Settings or the calendar with this Google account."
                    cancel="Cancel"
                    confirm="Remove"
                    busy={busy}
                    problem={problemAt(removePlace(id))}
                    onCancel={() => props.onCancelRemove(id)}
                    onConfirm={() => props.onRemove(id)}
                  />
                ) : (
                  <Button id={removeId(id)} variant="secondary" size="phone" className="h-auto min-h-14 py-2 whitespace-normal [overflow-wrap:anywhere]" onClick={() => props.onAskRemove(id)}>
                    Remove {account.email}
                  </Button>
                ))}
            </li>
          );
        })}
      </ul>

      {invite && (
        <div className="flex flex-col gap-4 border-t border-border pt-4">
          {invite.kind === 'none' && (
            <Button id={INVITE_MAIN} variant="secondary" size="phone" className="w-full" aria-disabled={busy || undefined} onClick={guarded(props.onMakeInvite)}>
              <Plus aria-hidden />
              Invite someone
            </Button>
          )}
          {invite.kind === 'made' && (
            <>
              <div className="flex flex-col gap-2">
                <Field label="Invite link">
                  <input className={fieldClass} readOnly value={invite.link} autoComplete="off" spellCheck={false} onFocus={(event) => event.target.select()} />
                </Field>
                <p className={helpClass}>Send this link to one person. It works once, until {date(invite.expiresAt)}.</p>
              </div>
              <div className={buttonRow}>
                {canShare && (
                  <Button variant="secondary" size="phone" className={buttonHalf} onClick={props.onShare}>
                    Share
                  </Button>
                )}
                <Button id={INVITE_MAIN} variant="secondary" size="phone" className={buttonHalf} onClick={props.onCopy}>
                  Copy
                </Button>
              </div>
              <Button variant="quiet" size="phone" className="w-full" aria-disabled={busy || undefined} onClick={guarded(props.onCancelInvite)}>
                Cancel invite
              </Button>
            </>
          )}
          {invite.kind === 'waiting' && (
            <>
              <p className="text-base">An invite is waiting, until {date(invite.expiresAt)}.</p>
              <div className={buttonRow}>
                <Button id={INVITE_MAIN} variant="secondary" size="phone" className={buttonHalf} aria-disabled={busy || undefined} onClick={guarded(props.onMakeInvite)}>
                  Make a new link
                </Button>
                <Button variant="quiet" size="phone" className={buttonHalf} aria-disabled={busy || undefined} onClick={guarded(props.onCancelInvite)}>
                  Cancel invite
                </Button>
              </div>
            </>
          )}
          <Problem id={problemId(INVITE)} problem={problemAt(INVITE)} />
        </div>
      )}
      <p role="status" className="min-h-6 text-base">
        {statusWords[status]}
      </p>
    </Card>
  );
}

// Settings, phone only: everyone who can sign in to the Household (the Household Accounts), and the invite for one more. Any of
// them may remove another, never themselves; an invite is a link, made here and sent by the phone's share sheet. There is no
// Realtime for these: the section reads again after each of its own writes.
export function HouseholdAccountsSection({ householdId, timezone, userId }: { householdId: string; timezone: string; userId: string }) {
  const [accounts, setAccounts] = useState<HouseholdAccountRow[] | null>(null);
  // The invite the database holds (undefined until it is read), and the link just made, which is on screen only until the page is
  // left, since only its hash is stored.
  const [stored, setStored] = useState<HouseholdInvite | null | undefined>(undefined);
  const [made, setMade] = useState<{ link: string; expiresAt: Date } | null>(null);
  const [status, setStatus] = useState<InviteStatus>('idle');
  // A trouble reading, kept apart from what a write said of itself, as in the tablets section.
  const [loadProblem, setLoadProblem] = useState<string | null>(null);
  const readFailed = useRef(false);
  const problems = useWriteProblem();
  const [open, setOpen] = useState<{ id: string; confirming: boolean } | null>(null);
  // One write at a time: the ref is the guard, the state is what is drawn (`aria-disabled`, never `disabled`).
  const working = useRef(false);
  const [busy, setBusy] = useState(false);
  const [focusNext, setFocusNext] = useState<string | null>(null);

  // Moves focus once the control it names is on screen; the swap unmounts whatever had it.
  useEffect(() => {
    if (focusNext === null) return;
    document.getElementById(focusNext)?.focus();
    setFocusNext(null);
  }, [focusNext]);

  const refresh = useCallback(async () => {
    try {
      const [list, waiting] = await Promise.all([listHouseholdAccounts(), readHouseholdInvite(householdId)]);
      setAccounts(list);
      setStored(waiting);
      setLoadProblem(null);
      readFailed.current = false;
    } catch {
      readFailed.current = true;
      setLoadProblem('Could not load who can sign in. Check your connection.');
    }
  }, [householdId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A read that failed is made again when the connection comes back, not on a timer.
  const connection = useConnection();
  useEffect(() => {
    if (connection === 'online' && readFailed.current) void refresh();
  }, [connection, refresh]);

  // One write, alone: `place` is where it says so when it fails (in `said`'s words, or the default ones), `done` what changes once it landed.
  async function write(place: string, run: () => Promise<void>, done: () => void, said?: { failed: string; offline: string }) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    try {
      await run();
      problems.clear(place);
    } catch (error) {
      problems.fail(place, error, said ? { said } : {});
      working.current = false;
      setBusy(false);
      return;
    }
    done();
    working.current = false;
    setBusy(false);
    await refresh();
  }

  const makeInvite = () =>
    void write(
      INVITE,
      async () => {
        const { token, expiresAt } = await createHouseholdInvite();
        setMade({ link: inviteLink(window.location.origin, token), expiresAt });
      },
      () => {
        setStatus('idle');
        setFocusNext(INVITE_MAIN);
      },
      MAKE_SAID,
    );

  const cancelInvite = () =>
    void write(
      INVITE,
      cancelHouseholdInvite,
      () => {
        setMade(null);
        // At once, so that the cancelled invite is not drawn while the read is on its way, and focus lands on Invite someone.
        setStored(null);
        setStatus('cancelled');
        setFocusNext(INVITE_MAIN);
      },
      CANCEL_SAID,
    );

  const remove = (id: string) =>
    void write(
      removePlace(id),
      () => removeHouseholdAccount(id),
      () => {
        setAccounts((list) => list && list.filter((account) => account.authUserId !== id));
        // Removing someone also cancels the waiting invite, server side: a link just made would be a dead one.
        setMade(null);
        setStored(null);
        setOpen(null);
        setFocusNext(INVITE_MAIN);
      },
    );

  async function copy() {
    if (!made) return;
    try {
      await navigator.clipboard.writeText(made.link);
      problems.clear(INVITE);
      setStatus('copied');
    } catch {
      setStatus('idle');
      problems.say(INVITE, COPY_FAILED);
    }
  }

  async function share() {
    if (!made) return;
    try {
      await navigator.share(sharePayload(made.link));
      problems.clear(INVITE);
    } catch (error) {
      // Closing the share sheet is not a failure.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      problems.say(INVITE, SHARE_FAILED);
    }
  }

  return (
    <HouseholdAccountsView
      accounts={accounts}
      invite={inviteViewOf(made, stored)}
      userId={userId}
      timezone={timezone}
      canShare={typeof navigator !== 'undefined' && typeof navigator.share === 'function'}
      open={open}
      busy={busy}
      status={status}
      loadProblem={loadProblem}
      problemAt={problems.at}
      onOpen={(id) => {
        problems.clear();
        setOpen(id === null ? null : { id, confirming: false });
      }}
      onAskRemove={(id) => {
        problems.clear();
        setOpen({ id, confirming: true });
      }}
      onCancelRemove={(id) => {
        problems.clear();
        setOpen({ id, confirming: false });
        setFocusNext(removeId(id));
      }}
      onRemove={remove}
      onMakeInvite={makeInvite}
      onCancelInvite={cancelInvite}
      onShare={() => void share()}
      onCopy={() => void copy()}
    />
  );
}
