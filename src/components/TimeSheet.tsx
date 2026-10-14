import { CircleAlert, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { timeInputWords } from '../lib/native-events';
import { drumOf, parseTypedTime, timeOfDrum, type Drum as DrumValue } from '../lib/time-picker';
import { Sheet } from './Sheet';
import { Button } from './ui/button';

// What the time sheet says of a time it cannot read, and of how to type one.
const HINT = 'Type a time like 4:30 PM';
const ROW = 48;
const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));
const MERIDIEMS = ['AM', 'PM'];
const footerButton = 'h-14 px-[24px] text-[17px]';

// One drum: a column of 48 px rows that scroll-snaps (CSS, no library), the chosen row centred. Two rows of room above and below let the
// first and the last rows reach the middle. A row's snap area is the row alone: the sheet's body gives everything in it a scroll margin
// at its foot (BODY_CLEARANCE), which would snap each row 36 px high, read as the row below it. The drums are decorative for a screen reader (aria-hidden, not in the tab order): the typed
// field is the accessible control. A roll is read where it ends (`scrollend`, or in a browser with none a scroll that has stopped
// coming in for 150 ms) and handed to `onRoll` as the row it came to rest on; a scroll the sheet made itself comes to rest on the row
// it is already on, which `onRoll` ignores.
function Drum({ rows, index, onRoll }: { rows: string[]; index: number; onRoll: (index: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const rolled = useRef(onRoll);
  useEffect(() => {
    rolled.current = onRoll;
  });
  // The chosen row to the middle: row i is centred when the box is scrolled i rows. Instantly: a scroll the sheet starts must not
  // still be on its way when the next key is typed.
  useEffect(() => {
    if (box.current) box.current.scrollTop = index * ROW;
  }, [index]);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const read = () => rolled.current(Math.min(Math.max(Math.round(element.scrollTop / ROW), 0), rows.length - 1));
    if ('onscrollend' in window) {
      element.addEventListener('scrollend', read);
      return () => element.removeEventListener('scrollend', read);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(read, 150);
    };
    element.addEventListener('scroll', soon);
    return () => {
      element.removeEventListener('scroll', soon);
      clearTimeout(timer);
    };
  }, [rows.length]);
  return (
    <div ref={box} aria-hidden="true" tabIndex={-1} className="h-60 flex-1 snap-y snap-mandatory overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
      <div className="h-24" />
      {rows.map((row, i) => (
        <div key={row} className={`flex h-12 snap-center scroll-m-0! items-center justify-center ${i === index ? 'text-[22px] font-semibold text-foreground' : 'text-muted-foreground'}`}>
          {row}
        </div>
      ))}
      <div className="h-24" />
    </div>
  );
}

// Starts or Ends in a sheet over the form (docs/specs/0013, The time sheet): a field to type a time in any plain way and three drums (hour,
// minute in fives, AM or PM) that roll under a finger. A roll rewrites the field; a time typed that can be read rolls the drums. Done
// or Enter hands the time to `onDone`, which says why it cannot be taken (a problem shows in the footer and the sheet stays open) or
// says nothing, and the sheet closes. Cancel, Close, Escape and the scrim leave the time as it was. It is drawn beside the form's
// sheet, not inside it, so that the Escape and the submit it hears (the Sheet's own) never reach the form's dialog through the React
// tree, which carries an event up through a portal.
export function TimeSheet({ which, time, onDone, onClose }: { which: 'start' | 'end'; time: string; onDone: (time: string) => string | undefined; onClose: () => void }) {
  const ids = useId();
  const field = useRef<HTMLInputElement>(null);
  const title = which === 'start' ? 'Starts' : 'Ends';
  // The time the drums show, and the words in the field, which are the same time until someone types.
  const [shown, setShown] = useState(time);
  const [text, setText] = useState(() => timeInputWords(time));
  // `n` counts what has been said, so the same problem again is heard again.
  const [problem, setProblem] = useState<{ words: string; n: number } | null>(null);
  // The meridiem a time typed with none takes: the field's as it was opened or last rolled, not whatever the keys typed so far read as.
  const [meridiem, setMeridiem] = useState(() => drumOf(time).meridiem);
  const drum = drumOf(shown);

  const say = (words: string) => setProblem((last) => ({ words, n: (last?.n ?? 0) + 1 }));

  const roll = (part: Partial<DrumValue>) => {
    const next = { ...drum, ...part };
    if (next.hour === drum.hour && next.minute === drum.minute && next.meridiem === drum.meridiem) return;
    const rolled = timeOfDrum(next);
    setShown(rolled);
    setMeridiem(next.meridiem);
    setText(timeInputWords(rolled));
    setProblem(null);
  };

  function submit(event: FormEvent) {
    event.preventDefault();
    const typed = parseTypedTime(text, meridiem);
    const words = typed === null ? HINT : onDone(typed);
    if (words) say(words);
    else onClose();
  }

  const header = (
    <div className="flex h-12 flex-none items-center justify-between">
      <h2 id={`${ids}-title`} className="font-display text-[30px] leading-9">
        {title}
      </h2>
      <Button variant="quiet" aria-label="Close" onClick={onClose} className="size-12 rounded-full p-0">
        <X aria-hidden className="size-[26px]" strokeWidth={2.2} />
      </Button>
    </div>
  );

  const footer = (
    <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-2">
      {problem && (
        <p key={problem.n} role="alert" className="flex min-w-0 basis-full items-center gap-2 text-[15px] font-medium">
          <CircleAlert aria-hidden className="size-[18px] shrink-0" />
          <span className="min-w-0 leading-5">{problem.words}</span>
        </p>
      )}
      <div className="flex min-w-0 flex-1 gap-3">
        <Button variant="quiet" className={`${footerButton} font-medium`} onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" className={`${footerButton} flex-1`}>
          Done
        </Button>
      </div>
    </div>
  );

  return (
    // Focus lands on the sheet itself, not the field: a field focused on open brings a tablet's keyboard up over the drums and Done.
    // A tap on the field brings it up, and selects the time there so a time typed replaces it.
    <Sheet labelledBy={`${ids}-title`} title={title} onClose={onClose} onSubmit={submit} className="max-w-[420px]" header={header} footer={footer}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-2">
            <span className="text-[15px] leading-5 text-muted-foreground">Time</span>
            <input
              ref={field}
              type="text"
              inputMode="text"
              autoComplete="off"
              aria-describedby={`${ids}-hint`}
              className="h-15 px-4 text-[17px]"
              value={text}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => {
                setText(e.target.value);
                setProblem(null);
                const typed = parseTypedTime(e.target.value, meridiem);
                if (typed !== null) setShown(typed);
              }}
            />
          </label>
          <p id={`${ids}-hint`} className="text-[15px] leading-5 text-muted-foreground">
            {HINT}
          </p>
        </div>
        <div className="flex gap-2">
          <Drum rows={HOURS} index={drum.hour - 1} onRoll={(i) => roll({ hour: i + 1 })} />
          <Drum rows={MINUTES} index={drum.minute / 5} onRoll={(i) => roll({ minute: i * 5 })} />
          <Drum rows={MERIDIEMS} index={drum.meridiem === 'AM' ? 0 : 1} onRoll={(i) => roll({ meridiem: i === 0 ? 'AM' : 'PM' })} />
        </div>
      </div>
    </Sheet>
  );
}
