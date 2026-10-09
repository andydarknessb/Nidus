import { tapFinishesProfile, type Routine } from './routines';

// What a tap on a Routine does, the same for a Profile's column on the Wall, its card on the phone and Up next: it ticks the Routine
// or takes the tick back, and when it ticks the Profile's last one, a burst of confetti starts where the finger was. This is the
// decision and the measuring; the screens only draw (src/components/RoutineColumn.tsx).

// The parts of an element this reads, so a test hands it plain numbers and the page hands it the element itself.
export type Measured = { getBoundingClientRect(): { top: number; height: number } };
export type Frame = Measured & { clientTop: number };

export type Tap = {
  // Whether the tap ticks the Routine (it was not done) or takes the tick back.
  checking: boolean;
  // Whether the tick finishes the Profile. Never without a frame to start the burst in.
  finishes: boolean;
  // How far down the frame the burst starts: the middle of the button, measured from the frame's padding edge, which is the burst's
  // own top. Null when the tap does not finish the Profile.
  burstAt: number | null;
};

// `routines` are the Profile's Routines today and `done` the ids done before the tap. `frame` is the column or card the burst is drawn
// over, null before it is on the page.
export function tapOutcome(routines: Routine[], done: ReadonlySet<string>, routineId: string, button: Measured, frame: Frame | null): Tap {
  const checking = !done.has(routineId);
  if (frame === null || !tapFinishesProfile(routines, done, routineId, checking)) return { checking, finishes: false, burstAt: null };
  const box = button.getBoundingClientRect();
  const top = frame.getBoundingClientRect().top + frame.clientTop;
  return { checking, finishes: true, burstAt: box.top + box.height / 2 - top };
}

// A tap on `routine`: starts the burst first when it finishes the Profile, then ticks or unticks it. Nothing waits on the save.
export function tapRoutine(args: {
  routines: Routine[];
  done: ReadonlySet<string>;
  routine: Routine;
  button: Measured;
  frame: Frame | null;
  onToggle: (routine: Routine) => Promise<boolean>;
  onFinish: (at: number) => void;
}): void {
  const { routines, done, routine, button, frame, onToggle, onFinish } = args;
  const { burstAt } = tapOutcome(routines, done, routine.id, button, frame);
  if (burstAt !== null) onFinish(burstAt);
  void onToggle(routine);
}
