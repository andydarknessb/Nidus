import { EmptyWords } from './EmptyWords';

// What stands in for a screen until the Household has been read (its Timezone says which day every screen
// shows): a frame that says "Loading" while the read is on its way and, once it has failed, the words that say so, in
// the screen's own wording, so a Wall that cannot reach its server does not pass for a blank one, nor a slow one for a broken one.
// The tablet's shell and the phone's screens (src/PhoneWall.tsx) draw the same one.
export function BeforeHousehold({ label, failed, words }: { label: string; failed: boolean; words: string }) {
  return (
    <section aria-label={label} className="rounded-3xl bg-card">
      {failed ? (
        <p role="alert" className="p-4 text-xl">
          {words}
        </p>
      ) : (
        <EmptyWords className="p-4">Loading</EmptyWords>
      )}
    </section>
  );
}
