import { ChevronDown, ChevronRight, Plus, Tablet } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Card, Confirm, Field, fieldClass } from '@/components/phone';
import { Button } from '@/components/ui/button';
import { useRefetchOn } from '@/lib/change-feed';
import { claimPairingCode, isInvalidCode, isTooManyAttempts, listDevices, revokeDevice, type Device } from '@/lib/device';
import { seenWords } from '@/lib/device-format';

const DEVICE_TABLES = ['devices'] as const;

const PAIR_ID = 'tablet-pair';

type PairStatus = 'idle' | 'pairing' | 'paired' | 'invalid' | 'tooMany' | 'failed';

const pairMessages: Record<PairStatus, string> = {
  idle: '',
  pairing: 'Pairing.',
  paired: 'Paired. The tablet will show the home screen in a few seconds.',
  invalid: 'That code is not valid. It may have expired or already been used. Check the tablet for a fresh one.',
  tooMany: 'Too many attempts. Wait 15 minutes and try again.',
  failed: 'Could not pair. Try again.',
};

// Settings, phone only: the Wall tablets (Devices). Pair one with the code it shows, see when each was last seen, and unpair one
// (revoke its Device), which sends it back to asking for a code. A Device never gets this screen.
export function DevicesSection() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [problem, setProblem] = useState<string | null>(null);
  const [pairing, setPairing] = useState<{ code: string; name: string } | null>(null);
  const [pairStatus, setPairStatus] = useState<PairStatus>('idle');
  // The tablet whose row is open, and whether it is being asked to be sure.
  const [open, setOpen] = useState<{ id: string; confirming: boolean } | null>(null);
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
      setProblem(null);
    } catch {
      setProblem('Could not load tablets. Check your connection.');
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
    if (!pairing || pairStatus === 'pairing') return;
    setPairStatus('pairing');
    try {
      await claimPairingCode(pairing.code, pairing.name);
      setPairing(null);
      setPairStatus('paired');
      setFocusNext(PAIR_ID);
      await refresh();
    } catch (error) {
      setPairStatus(isInvalidCode(error) ? 'invalid' : isTooManyAttempts(error) ? 'tooMany' : 'failed');
    }
  }

  async function unpair(id: string) {
    try {
      await revokeDevice(id);
      setOpen(null);
      setFocusNext(PAIR_ID);
      await refresh();
    } catch {
      setProblem('Could not unpair the tablet. Try again.');
    }
  }

  return (
    <Card title="Wall tablets">
      {problem && (
        <p role="alert" className="text-base">
          {problem}
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
                className="h-14 w-full justify-start gap-3 px-3.5 text-left font-medium"
                onClick={() => setOpen(expanded ? null : { id: device.id, confirming: false })}
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
                    onCancel={() => {
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
                    onClick={() => setOpen({ id: device.id, confirming: true })}
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
              />
            </Field>
            <Field label="Tablet name">
              <input className={fieldClass} autoComplete="off" value={pairing.name} onChange={(e) => setPairing({ ...pairing, name: e.target.value })} maxLength={100} placeholder="Kitchen" required />
            </Field>
            <div className="flex gap-2">
              <Button
                variant="quiet"
                size="phone"
                className="flex-1"
                onClick={() => {
                  setPairing(null);
                  setPairStatus('idle');
                  setFocusNext(PAIR_ID);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" variant="secondary" size="phone" className="flex-1" disabled={pairStatus === 'pairing'}>
                Pair tablet
              </Button>
            </div>
          </form>
        ) : (
          <Button
            id={PAIR_ID}
            variant="secondary"
            size="phone"
            className="w-full"
            onClick={() => {
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
