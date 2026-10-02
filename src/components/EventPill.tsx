import { cn } from 'cn';
import { Pin } from 'lucide-react';
import type { Occurrence, WallDay } from '../lib/calendar-occurrences';
import { personStyle } from '../lib/look';
import { pillName, type Pill, type PillPeople } from '../lib/schedule';
import { HouseDisc, PersonDisc } from './people';
import { Button } from './ui/button';

// The fill of an event (docs/look.md, People): the whole Household's --everyone, or one flat band of each Profile's
// fill for each of the first three, equal and left to right in Profile order. Flat bands, not a gradient: each is an
// element of its own, so each is drawn in its person's roles. Put it first inside a `relative` box that is round
// (it takes the box's corners); what is drawn over it is `relative` too.
export function EventFill({ people }: { people: PillPeople }) {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 flex overflow-hidden rounded-[inherit]">
      {people.kind === 'everyone' ? (
        <span className="flex-1 bg-everyone" />
      ) : (
        people.bands.map((profile) => <span key={profile.id} className="person flex-1 bg-person-fill" style={personStyle(profile.color)} />)
      )}
    </span>
  );
}

// Who it is for, at the right of the row under a title: the house for the whole Household, else a disc for each of one or
// two Profiles, or for three or more the first one's disc and a "+N" disc that counts the rest, so it is never more than two
// discs wide. Discs overlap by 4 px, and are told apart by a ring in the card's colour: any more of the first disc covered
// and the right side of an O, an M or a W is lost. The names are in the pill's own name, so this is for the eye only.
export function EventDiscs({ people }: { people: PillPeople }) {
  if (people.kind === 'everyone') return <HouseDisc size={24} />;
  const overlapping = people.discs.length + (people.more > 0 ? 1 : 0) > 1;
  const ring = overlapping ? 'rounded-full ring-2 ring-card' : '';
  return (
    <span aria-hidden className="flex shrink-0 items-center">
      {people.discs.map((profile, index) => (
        <span key={profile.id} className={cn(ring, index > 0 && '-ml-1')}>
          <PersonDisc name={profile.name} color={profile.color} size={24} />
        </span>
      ))}
      {people.more > 0 && <span className="-ml-1 grid size-6 place-items-center rounded-full bg-card text-sm leading-none font-semibold ring-2 ring-card">+{people.more}</span>}
    </span>
  );
}

// "2:00 PM" with its AM or PM held to the time, so a narrow pill wraps between "Until" and the time, never inside it.
const holdTime = (time: string) => time.replace(/ ([AP]M)$/, '\u00a0$1');

// One event on the schedule (docs/look.md, The parts): at least 52 px tall and 14 round. The title has the whole width of
// the pill, on up to two lines (it wraps between words and never inside one, then ends in an ellipsis); under it is one row,
// the time at the left and who it is for at the right, centred on each other. The row wraps, the discs keeping to the right,
// when the time's words and the discs do not fit together ("Until 12:30 PM" and two discs), so nothing is ever clipped or
// overlapped. A Native Event has the pin before its title. The timed event that is on now has a 2.5 px inset ring in
// --foreground, drawn over the fill as a shape of its own so the focus ring (the outline) stays free for the keyboard.
// `className` is for the column that holds a pill it is not drawing: it is still measured.
export function EventPill({
  pill,
  day,
  people,
  onOpen,
  className,
}: {
  pill: Pill;
  day: WallDay;
  people: PillPeople;
  onOpen: (occurrence: Occurrence) => void;
  className?: string | undefined;
}) {
  const { occurrence } = pill;
  return (
    <Button
      variant="quiet"
      data-pill
      aria-label={pillName(pill, day, people)}
      onClick={() => onOpen(occurrence)}
      className={cn(
        'relative h-auto min-h-13 w-full flex-col items-stretch justify-start gap-0 rounded-[14px] px-0 py-1.5 pr-2 pl-2.5 text-left font-normal whitespace-normal text-foreground',
        className,
      )}
    >
      <EventFill people={people} />
      <span className="relative line-clamp-2 text-[15px] text-ellipsis leading-[19px] font-semibold">
        {occurrence.source === 'native' && <Pin aria-hidden data-testid="native-mark" className="mr-1 inline size-3.5 align-[-2px]" />}
        {occurrence.title}
      </span>
      <span className="relative flex flex-wrap items-center gap-x-1 gap-y-0.5">
        <span className="text-sm leading-[18px]">{holdTime(pill.time)}</span>
        <span className="ml-auto flex">
          <EventDiscs people={people} />
        </span>
      </span>
      {pill.onNow && <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_2.5px_var(--foreground)]" />}
    </Button>
  );
}
