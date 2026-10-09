import { ReadState } from './ReadState';

// What stands in for a screen until the Household has been read (its Timezone says which day every screen
// shows): a frame that says "Loading" while the read is on its way and, once it has failed, that `of` (what the screen shows) could
// not be loaded, so a Wall that cannot reach its server does not pass for a blank one, nor a slow one for a broken one.
// The tablet's shell and the phone's screens (src/PhoneWall.tsx) draw the same one.
export function BeforeHousehold({ label, failed, of }: { label: string; failed: boolean; of: string }) {
  return (
    <section aria-label={label} className="rounded-3xl bg-card phone:rounded-[22px]">
      <ReadState of={of} read={{ state: failed ? 'failed' : 'loading' }} className="p-4" alert="p-4 text-xl" />
    </section>
  );
}
