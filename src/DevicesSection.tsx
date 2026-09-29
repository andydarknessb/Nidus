import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { claimPairingCode, isInvalidCode, isTooManyAttempts, listDevices, revokeDevice, type Device } from './lib/device';
import { lastSeenLabel } from './lib/device-format';

const field = 'min-h-12 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground';
const action = 'min-h-12 rounded-lg px-4 text-base font-medium';

type PairStatus = 'idle' | 'pairing' | 'paired' | 'invalid' | 'tooMany' | 'failed';

const pairMessages: Record<PairStatus, string> = {
  idle: '',
  pairing: 'Pairing.',
  paired: 'Paired. The tablet will show the home screen in a few seconds.',
  invalid: 'That code is not valid. It may have expired or already been used. Check the tablet for a fresh one.',
  tooMany: 'Too many attempts. Wait 15 minutes and try again.',
  failed: 'Could not pair. Try again.',
};

// Settings, phone only: pair a tablet with the code it shows, see when each
// Device was last seen, and revoke one.
export function DevicesSection() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [loadFailed, setLoadFailed] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [pairStatus, setPairStatus] = useState<PairStatus>('idle');
  const [confirming, setConfirming] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setDevices(await listDevices());
      setNow(new Date());
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Keeps "last seen" honest while the page stays open.
    const id = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  async function pair(event: FormEvent) {
    event.preventDefault();
    setPairStatus('pairing');
    try {
      await claimPairingCode(code, name);
      setCode('');
      setName('');
      setPairStatus('paired');
      await refresh();
    } catch (error) {
      setPairStatus(isInvalidCode(error) ? 'invalid' : isTooManyAttempts(error) ? 'tooMany' : 'failed');
    }
  }

  async function revoke(id: string) {
    try {
      await revokeDevice(id);
      setConfirming(null);
      await refresh();
    } catch {
      setLoadFailed(true);
    }
  }

  return (
    <section aria-labelledby="devices-heading" className="flex flex-col gap-4">
      <h2 id="devices-heading" className="text-xl font-semibold">
        Devices
      </h2>

      <form onSubmit={(event) => void pair(event)} className="flex flex-col gap-4">
        <label className="flex flex-col gap-2 text-base">
          Code shown on the tablet
          <input
            className={`${field} font-mono uppercase tracking-widest`}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={12}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            required
          />
        </label>
        <label className="flex flex-col gap-2 text-base">
          Device name
          <input
            className={field}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            placeholder="Kitchen"
            required
          />
        </label>
        <button type="submit" className={`${action} bg-primary text-primary-foreground`} disabled={pairStatus === 'pairing'}>
          Pair tablet
        </button>
        <p role="status" className="min-h-6 text-base">
          {pairMessages[pairStatus]}
        </p>
      </form>

      {loadFailed && (
        <p role="alert" className="text-base">
          Could not load Devices. Check your connection.
        </p>
      )}
      {devices?.length === 0 && <p className="text-base">No Devices paired yet.</p>}
      <ul className="flex flex-col gap-3">
        {devices?.map((device) => (
          <li key={device.id} className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <div>
              <p className="text-base font-medium">{device.name}</p>
              <p className="text-base">Last seen: {lastSeenLabel(device.last_seen_at, now)}</p>
            </div>
            {confirming === device.id ? (
              <div className="flex gap-3">
                <button type="button" className={`${action} flex-1 bg-primary text-primary-foreground`} onClick={() => void revoke(device.id)}>
                  Revoke {device.name}
                </button>
                <button type="button" className={`${action} border border-border`} onClick={() => setConfirming(null)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button type="button" className={`${action} border border-border`} onClick={() => setConfirming(device.id)}>
                Revoke
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
