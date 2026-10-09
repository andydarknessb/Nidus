import { ChevronDown, ChevronRight, Plus, Tablet } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Card, Confirm, Field, Problem, buttonHalf, buttonRow, fieldClass, statusLineClass } from '@/components/phone';
import { Button } from '@/components/ui/button';
import { claimPairingCode, isInvalidCode, isTooManyAttempts, listDevices, revokeDevice } from '@/lib/device';
import { seenWords } from '@/lib/device-format';
import { supabase } from '@/lib/supabase';
import { useCardWrite } from '@/lib/use-card-write';
import { useWriteProblem } from '@/lib/use-write-problem';
import { couldNotLoad, useSyncedRead } from '@/lib/synced-read';

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
  // Read through the synced read: every 30 seconds keeps "last seen" honest while the page stays open, and a read follows each
  // write. A trouble reading, which a read that works takes away, is kept apart from what a write said of itself: a good read says
  // nothing of whether the unpairing did, so its words stay while its question is open.
  const read = useSyncedRead(async () => ({ devices: await listDevices(supabase), now: new Date() }), DEVICE_TABLES, 'devices');
  const devices = read.data?.devices ?? null;
  const now = read.data?.now ?? new Date();
  const loadProblem = read.failed ? couldNotLoad('tablets') : null;
  const problems = useWriteProblem();
  const [pairing, setPairing] = useState<{ code: string; name: string } | null>(null);
  const [pairStatus, setPairStatus] = useState<PairStatus>('idle');
  // The tablet whose row is open, and whether it is being asked to be sure.
  const [open, setOpen] = useState<{ id: string; confirming: boolean } | null>(null);
  // One write at a time (the card write guard): the card draws `aria-disabled` from `busy`, and says where focus goes afterwards.
  const card = useCardWrite(problems);
  const { busy } = card;

  async function pair(event: FormEvent) {
    event.preventDefault();
    if (!pairing) return;
    await card.run(
      async () => {
        setPairStatus('pairing');
        await read.write(() => claimPairingCode(supabase, pairing.code, pairing.name));
        problems.clear(PAIR);
      },
      {
        place: PAIR,
        words: { said: PAIR_SAID },
        failed: (error) => {
          setPairStatus('idle');
          if (isInvalidCode(error)) problems.say(PAIR, INVALID_CODE_WORDS, true);
          else if (isTooManyAttempts(error)) problems.say(PAIR, TOO_MANY_WORDS);
          else return false;
          return true;
        },
        landed: () => {
          setPairing(null);
          setPairStatus('paired');
          return PAIR_ID;
        },
      },
    );
  }

  async function unpair(id: string) {
    await card.run(
      async () => {
        await read.write(() => revokeDevice(supabase, id));
        problems.clear(unpairPlace(id));
      },
      {
        place: unpairPlace(id),
        landed: () => {
          setOpen(null);
          return PAIR_ID;
        },
      },
    );
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
                      card.focus(`unpair-${device.id}`);
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
                  card.focus(PAIR_ID);
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
        <p role="status" className={statusLineClass}>
          {pairMessages[pairStatus]}
        </p>
      </div>
    </Card>
  );
}
