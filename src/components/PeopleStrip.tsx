import { cn } from 'cn';
import { ChevronRight, Star } from 'lucide-react';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { personStyle } from '../lib/look';
import type { ProfileFilter } from '../lib/profile-filter';
import type { Profile } from '../lib/profiles';
import { stripPeople, type StripPerson } from '../lib/schedule';
import type { RoutinesToday } from '../lib/use-routines-today';
import { HouseDisc, MAX_PIPS, PersonDisc, Pips, Tick } from './people';
import { Button } from './ui/button';

// The people strip (docs/look.md, The parts): one row under the header on the calendar screens. Everyone, then a pill
// for each Profile on its soft colour: the disc, the name, "3 of 5" and the pips. Pressing a pill filters the calendar
// to that person and the whole Household's events; Everyone clears it. A pill that is pressed shows a tick in its disc.
//
// The pills share the room equally. When a pill is too narrow for the count and the pips it shrinks to its disc and
// name (a container query on the pill itself, which measures what is inside its padding: 9 rem there is a pill of about
// 166 px, the least the pips and a short name's count need, so five people still show their progress), and when even
// those cannot share the room the row scrolls sideways, with a button, "More people", that says so and moves it on.

// The gap between the strip's parts and between its pills.
const GAP_PX = 8;

// The disc, the name and, in a pill wide enough, the count and the pips. The count is what gives way first when the name
// is long: it drops to a line of its own that is not shown, so the name is never cut short for it.
function PersonPill({ person, on }: { person: StripPerson; on: boolean }) {
  const { profile, words, done, total } = person;
  return (
    <>
      {on ? <Tick size={40} color={profile.color} strong /> : <PersonDisc name={profile.name} color={profile.color} size={40} />}
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex h-5 flex-wrap items-baseline justify-between gap-x-2 overflow-hidden">
          <span className="min-w-0 truncate text-base leading-5 font-semibold">{profile.name}</span>
          {words && (
            <span aria-hidden className={cn('hidden shrink-0 items-center gap-1 text-sm leading-[18px] @min-[9rem]:flex', words === 'All done' ? 'font-semibold' : 'text-muted-foreground')}>
              {words === 'All done' && <Star className="size-3.5" />}
              {words}
            </span>
          )}
        </span>
        {total > 0 && total <= MAX_PIPS && (
          <span className="hidden @min-[9rem]:block">
            <Pips done={done} total={total} label={person.label} color={profile.color} />
          </span>
        )}
      </span>
    </>
  );
}

const PILL = 'person @container h-14 min-w-32 max-w-76 flex-1 basis-0 rounded-[18px] bg-person-soft text-base text-foreground';

// The row of pills and, past it, "More people". `people` has at least one.
function Strip({ people, filter, pressed }: { people: StripPerson[]; filter: ProfileFilter; pressed: readonly string[] }) {
  // With one Profile there is nobody to pick between: no Everyone, and its pill shows progress and does not filter.
  const alone = people.length === 1;
  const scroller = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const [scroll, setScroll] = useState({ overflowing: false, atEnd: true });

  // Whether the pills need more room than the row has, and whether the row is scrolled to its end. The button takes room
  // from the row, so the room the pills would have without it is what they are held to: drawing the button never decides
  // whether it is needed, and it does not come and go as the row is scrolled.
  const measure = useCallback(() => {
    const element = scroller.current;
    if (!element) return;
    const room = element.clientWidth + (more.current ? more.current.offsetWidth + GAP_PX : 0);
    const next = { overflowing: element.scrollWidth > room, atEnd: element.scrollLeft + element.clientWidth >= element.scrollWidth - 1 };
    setScroll((last) => (last.overflowing === next.overflowing && last.atEnd === next.atEnd ? last : next));
  }, []);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure]);
  // A person coming or going is a render, not a resize of the row.
  useLayoutEffect(measure);

  return (
    <div role="group" aria-label="Show events for" className="flex h-14 gap-2">
      {!alone && (
        <Button variant="quiet" aria-pressed={pressed.length === 0} onClick={filter.clear} className="h-14 gap-2.5 rounded-[18px] bg-card px-0 pr-4.5 pl-2 text-base text-foreground">
          <HouseDisc size={40} />
          Everyone
        </Button>
      )}
      <div ref={scroller} onScroll={measure} className="flex min-w-0 flex-1 gap-2 overflow-x-auto [scrollbar-width:none]">
        {people.map((person) =>
          alone ? (
            <div key={person.profile.id} style={personStyle(person.profile.color)} className={cn(PILL, 'flex items-center gap-2.5 py-0 pr-3.5 pl-2')}>
              <PersonPill person={person} on={false} />
            </div>
          ) : (
            <Button
              key={person.profile.id}
              variant="quiet"
              aria-pressed={pressed.includes(person.profile.id)}
              aria-label={person.label}
              onClick={() => filter.toggle(person.profile.id)}
              style={personStyle(person.profile.color)}
              className={cn(PILL, 'justify-start gap-2.5 px-0 pr-3.5 pl-2 text-left selected:bg-person-soft focus-visible:-outline-offset-2')}
            >
              <PersonPill person={person} on={pressed.includes(person.profile.id)} />
            </Button>
          ),
        )}
      </div>
      {scroll.overflowing && (
        <Button
          ref={more}
          variant="secondary"
          disabled={scroll.atEnd}
          onClick={() => scroller.current?.scrollBy({ left: scroller.current.clientWidth * 0.8 })}
          className="h-14 gap-1 rounded-[18px] bg-card px-3.5 text-sm"
        >
          More people
          <ChevronRight aria-hidden className="size-[18px]" />
        </Button>
      )}
    </div>
  );
}

// The strip for the Wall's calendar screens. `profiles` are the Household's, null until they are read, and `routines`
// is the Wall's one reader of today's Routines, so the strip reads nothing of its own. While the Profiles are being
// read the row keeps its height, so the calendar under it does not move when they arrive; a Household with no
// Profiles has nothing to show.
export function PeopleStrip({ profiles, routines, filter, pressed }: { profiles: Profile[] | null; routines: RoutinesToday; filter: ProfileFilter; pressed: readonly string[] }) {
  if (profiles === null) return <div className="h-14" />;
  if (profiles.length === 0) return null;
  return <Strip people={stripPeople(profiles, routines.groups, routines.done)} filter={filter} pressed={pressed} />;
}
