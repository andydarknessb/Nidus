import { ChevronDown, ChevronRight, Plus, Tablet } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Card, Confirm, Field, Problem, buttonHalf, buttonRow, fieldClass } from '@/components/phone';
import { Button } from '@/components/ui/button';
import { useRefetchOn } from '@/lib/change-feed';
import { claimPairingCode, isInvalidCode, isTooManyAttempts, listDevices, revokeDevice, type Device } from '@/lib/device';
import { seenWords } from '@/lib/device-format';
import { useWriteProblem } from '@/lib/use-write-problem';

const DEVICE_TABLES = ['devices'] as const;

const PAIR_ID = 'tablet-pair';

// What the progress and the success of pairing say, under the form, where it was; a failure says so inside the form (below).
type PairStatus = 'idle' | 'pairing' | 'paired';

const pairMessages: Record<PairStatus, string> = {
  idle: '',
  pairing: 'Pairing.',
  paired: 'Paired. The tablet will show the home screen in a few seconds.',
};

// What a pairing that did not go through says: a code the server did not take, too many tries, and, for anything else, the Wall's
// two sentences with the verb that fits.
const INVALID_CODE_WORDS = 'That code is not valid. It may have expired or already been used. Check the tablet for a fresh one.';
const TOO_MANY_WORDS = 'Too many attempts. Wait 15 minutes and try again.';
const PAIR_SAID = { failed: 'Could not pair. Try again.', offline: 'No internet, so that did not pair. Try again soon.' };

// Where a write that failed says so: in the form to pair, or in the question about unpairing a tablet.
const PAIR = 'pair';
const unpairPlace = (id: string) => `unpair-${id}`;
const problemId = (place: string) => `problem-${place}`;

// Settings, phone only: the Wall tablets (Devices). Pair one with the code it shows, see when each was last seen, and unpair one
// (revoke its Device), which sends it back to asking for a code. A Device never gets this screen.
export function DevicesSection() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [now, setNow] = useState(() => new Date());
  // A trouble reading, which a read that works takes away, every 30 seconds. What a write said of itself is kept apart: a good read
  // says nothing of whether the unpairing did, so its words stay while its question is open.
  const [loadProblem, setLoadProblem] = useState<string | null>(null);
  const problems = useWriteProblem();
  const [pairing, setPairing] = useState<{ code: string; name: string } | null>(null);
  const [pairStatus, setPairStatus] = useState<PairStatus>('idle');
  // The tablet whose row is open, and whether it is being asked to be sure.
  const [open, setOpen] = useState<{ id: string; confirming: boolean } | null>(null);
  // One write at a time: the ref is the guard, the state is what is drawn (`aria-disabled`, never `disabled`: a button that is
  // disabled while it has focus drops it to the page).
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
      setDevices(await listDevices());
      setNow(new Date());
      setLoadProblem(null);
    } catch {
      setLoadProblem('Could not load tablets. Check your connection.');
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Keeps "last seen" honest while the page stays open.
    const id = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(id);
  }, [refresh]);
  useRefetchOn(DEVICE_TABLES, () => void refresh());

  async function pair(event: FormEvent) {
    event.preventDefault();
    if (!pairing || working.current) return;
    working.current = true;
    setBusy(true);
    setPairStatus('pairing');
    try {
      await claimPairingCode(pairing.code, pairing.name);
      problems.clear(PAIR);
    } catch (error) {
      setPairStatus('idle');
      if (isInvalidCode(error)) problems.say(PAIR, INVALID_CODE_WORDS, true);
      else if (isTooManyAttempts(error)) problems.say(PAIR, TOO_MANY_WORDS);
      else problems.fail(PAIR, error, { said: PAIR_SAID });
      working.current = false;
      setBusy(false);
      return;
    }
    setPairing(null);
    setPairStatus('paired');
    setFocusNext(PAIR_ID);
    working.current = false;
    setBusy(false);
    await refresh();
  }

  async function unpair(id: string) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    try {
      await revokeDevice(id);
      problems.clear(unpairPlace(id));
    } catch (error) {
      problems.fail(unpairPlace(id), error);
      working.current = false;
      setBusy(false);
      return;
    }
    setOpen(null);
    setFocusNext(PAIR_ID);
    working.current = false;
    setBusy(false);
    await refresh();
  }

  const pairProblem = problems.at(PAIR);

  return (
    <Card title="Wall tablets">
      {loadProblem && (
        <p role="alert" className="text-base">
          {loadProblem}
        </p>
      )}
      {devices?.length === 0 && <p className="text-base">No tablet is paired yet.</p>}
      <ul className="flex flex-col gap-2">
        {devices?.map((device) => {
          const expanded = open?.id === device.id;
          return (
            <li key={device.id} className="flex flex-col gap-4">
              <Button
                id={`tablet-${device.id}`}
                variant="secondary"
                aria-expanded={expanded}
                className="h-14 w-full justify-start gap-3 rounded-[14px] px-3.5 text-left font-medium"
                onClick={() => {
                  problems.clear();
                  setOpen(expanded ? null : { id: device.id, confirming: false });
                }}
              >
                <Tablet aria-hidden className="size-[22px]" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[17px] leading-[22px] font-medium">{device.name}</span>
                  <span className="text-sm leading-[18px] font-normal text-muted-foreground">{seenWords(device.last_seen_at, now)}</span>
                </span>
                {expanded ? <ChevronDown aria-hidden className="size-[22px] text-muted-foreground" /> : <ChevronRight aria-hidden className="size-[22px] text-muted-foreground" />}
              </Button>
              {expanded &&
                (open.confirming ? (
                  <Confirm
                    title={`Unpair ${device.name}?`}
                    words="The tablet stops showing your household and goes back to showing a code. You can pair it again any time."
                    cancel="Cancel"
                    confirm={`Unpair ${device.name}`}
                    busy={busy}
                    problem={problems.at(unpairPlace(device.id))}
                    onCancel={() => {
                      problems.clear();
                      setOpen({ id: device.id, confirming: false });
                      setFocusNext(`unpair-${device.id}`);
                    }}
                    onConfirm={() => void unpair(device.id)}
                  />
                ) : (
                  <Button
                    id={`unpair-${device.id}`}
                    variant="secondary"
                    size="phone"
                    className="h-auto min-h-14 py-2 whitespace-normal [overflow-wrap:anywhere]"
                    onClick={() => {
                      problems.clear();
                      setOpen({ id: device.id, confirming: true });
                    }}
                  >
                    Unpair {device.name}
                  </Button>
                ))}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-2">
        {pairing ? (
          <form onSubmit={(event) => void pair(event)} className="flex flex-col gap-4 border-t border-border pt-4">
            <Field label="Code shown on the tablet">
              <input
                className={`${fieldClass} uppercase tracking-widest`}
                autoFocus
                value={pairing.code}
                onChange={(e) => setPairing({ ...pairing, code: e.target.value.toUpperCase() })}
                maxLength={12}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                required
                aria-invalid={pairProblem?.refused || undefined}
                aria-describedby={pairProblem?.refused ? problemId(PAIR) : undefined}
              />
            </Field>
            <Field label="Tablet name">
              <input className={fieldClass} autoComplete="off" value={pairing.name} onChange={(e) => setPairing({ ...pairing, name: e.target.value })} maxLength={100} placeholder="Kitchen" required />
            </Field>
            <div className={buttonRow}>
              <Button
                variant="quiet"
                size="phone"
                className={buttonHalf}
                aria-disabled={busy || undefined}
                onClick={() => {
                  if (busy) return;
                  problems.clear();
                  setPairing(null);
                  setPairStatus('idle');
                  setFocusNext(PAIR_ID);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" variant="secondary" size="phone" className={buttonHalf} aria-disabled={busy || undefined}>
                Pair tablet
              </Button>
            </div>
            <Problem id={problemId(PAIR)} problem={pairProblem} />
          </form>
        ) : (
          <Button
            id={PAIR_ID}
            variant="secondary"
            size="phone"
            className="w-full"
            onClick={() => {
              problems.clear();
              setPairing({ code: '', name: '' });
              setPairStatus('idle');
            }}
          >
            <Plus aria-hidden />
            Pair a tablet
          </Button>
        )}
        <p role="status" className="min-h-6 text-base">
          {pairMessages[pairStatus]}
        </p>
      </div>
    </Card>
  );
}
