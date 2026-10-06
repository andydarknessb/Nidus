import { cn } from 'cn';
import type { CSSProperties } from 'react';
import { personStyle } from '../lib/look';
import type { ProfileFilter } from '../lib/profile-filter';
import type { Profile } from '../lib/profiles';
import { stripPeople, type StripPerson } from '../lib/schedule';
import { useOverflow } from '../lib/use-overflow';
import type { RoutinesToday } from '../lib/use-routines-today';
import { OverflowButton } from './OverflowButton';
import { HouseDisc, MAX_PIPS, PersonDisc, Pips, Tick } from './people';
import { Button } from './ui/button';

// The people strip (docs/look.md, The parts): one row under the header on the calendar screens. Everyone, then a pill
// for each Profile on its soft colour: the disc, the name, "3 of 5" and the pips. Pressing a pill filters the calendar
// to that person and the whole Household's events; Everyone clears it. A pill that is pressed shows a tick in its disc.
//
// The pills share the room equally. When a pill is too narrow for the count and the pips it shrinks to its disc and
// name (a container query on the pill itself, which measures what is inside its padding: 9.6 rem there is a pill of about
// 176 px, the least the pips and a short name's count need, "All done" too, so five people still show their progress), and when even
// those, each with its whole name, cannot share the room the row scrolls sideways (a name is cut only at the widest a
// pill goes, never to fit the row), with a button, "More people", that says so and moves it on; at the
// end of the row it reads "Back" and returns to the first people (OverflowButton).

// On a phone (below 768 px wide, spec 0004) the strip is one row that scrolls sideways under a finger: Everyone and then the pills,
// each 132 px wide and 52 tall, a 36 px disc (the discs' own size is a style, so the class is important), the name and the pips,
// the last one cut at the edge, and no "More people" button. The row's classes are the tablet's with `max-[768px]:` variants over
// them (never the `sm:` or `md:` ones, which Tailwind emits after them), so from 768 px nothing changes. A pill's inline
// minimum width, which is the name's, gives way to the 132 px with an important class.
const PHONE_DISC = 'max-[768px]:size-9!';

// The disc, the name and, in a pill wide enough, the count and the pips. The count is what gives way first when the name
// is long: it drops to a line of its own that is not shown, so the name is never cut short for it.
function PersonPill({ person, on }: { person: StripPerson; on: boolean }) {
  const { profile, words, done, total } = person;
  return (
    <>
      {on ? <Tick size={40} color={profile.color} strong className={PHONE_DISC} /> : <PersonDisc name={profile.name} color={profile.color} size={40} className={PHONE_DISC} />}
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex h-5 flex-wrap items-baseline justify-between gap-x-2 overflow-hidden">
          <span className="min-w-0 truncate text-base leading-5 font-semibold">{profile.name}</span>
          {words && (
            <span aria-hidden className={cn('hidden shrink-0 text-sm leading-[18px] @min-[9.6rem]:flex', words === 'All done' ? 'font-semibold' : 'text-muted-foreground')}>
              {words}
            </span>
          )}
        </span>
        {total > 0 && total <= MAX_PIPS && (
          <span className="hidden @min-[9.6rem]:block max-[768px]:block">
            <Pips done={done} total={total} label={person.label} color={profile.color} />
          </span>
        )}
      </span>
    </>
  );
}

const PILL =
  'person @container h-14 min-w-32 max-w-76 flex-1 basis-0 rounded-[18px] bg-person-soft text-base text-foreground max-[768px]:h-13 max-[768px]:w-[132px] max-[768px]:min-w-[132px]! max-[768px]:max-w-[132px] max-[768px]:flex-none max-[768px]:basis-auto';

// The least a pill is: the disc, its gaps and padding (4.5 rem) and the name's letters (one ch each, a little over what a
// name needs), never under the 8 rem of min-w-32 and never over the 19 rem of max-w-76, where the name is cut. A pill
// is a container, whose width ignores what is inside it, so the name's width has to be given to it.
const pillStyle = (profile: Profile): CSSProperties => ({ ...personStyle(profile.color), minWidth: `max(8rem, min(19rem, calc(${profile.name.length}ch + 4.5rem)))` });

// The row of pills and, past it, "More people". `people` has at least one.
function Strip({ people, filter, pressed }: { people: StripPerson[]; filter: ProfileFilter; pressed: readonly string[] }) {
  // With one Profile there is nobody to pick between: no Everyone, and its pill shows progress and does not filter.
  const alone = people.length === 1;
  // Whether the pills need more room than the row has, and whether the row is scrolled to its end. The button takes room
  // from the row, so the room the pills would have without it is what they are held to: drawing the button never decides
  // whether it is needed, and it does not come and go as the row is scrolled.
  const more = useOverflow('x', 'beside');

  return (
    <div
      role="group"
      aria-label="Show events for"
      className="flex h-14 gap-2 max-[768px]:h-13 max-[768px]:-mx-4 max-[768px]:items-center max-[768px]:scroll-px-4 max-[768px]:px-4 max-[768px]:overflow-x-auto max-[768px]:overscroll-x-contain max-[768px]:[scrollbar-width:none] max-[768px]:[&::-webkit-scrollbar]:hidden max-[768px]:[&>*]:shrink-0"
    >
      {!alone && (
        <Button
          variant="quiet"
          aria-pressed={pressed.length === 0}
          onClick={filter.clear}
          className="h-14 gap-2.5 rounded-[18px] bg-card px-0 pr-4.5 pl-2 text-base text-foreground max-[768px]:h-13 max-[768px]:min-w-[132px] max-[768px]:gap-2 max-[768px]:pr-2 max-[768px]:focus-visible:-outline-offset-2"
        >
          <HouseDisc size={40} className={PHONE_DISC} />
          Everyone
        </Button>
      )}
      {/* On a phone this box is `contents`, so the pills are the row's own items and the row is what scrolls. */}
      <div ref={more.scroller} className="flex min-w-0 flex-1 gap-2 overflow-x-auto [scrollbar-width:none] max-[768px]:contents">
        {people.map((person) =>
          alone ? (
            <div key={person.profile.id} style={pillStyle(person.profile)} className={cn(PILL, 'flex items-center gap-2.5 py-0 pr-3.5 pl-2')}>
              <PersonPill person={person} on={false} />
              {/* Past the pips the progress is the hidden count alone, and this pill has no button label to carry it. */}
              {person.total > MAX_PIPS && <span className="sr-only">{`${person.done} of ${person.total} routines done`}</span>}
            </div>
          ) : (
            <Button
              key={person.profile.id}
              variant="quiet"
              aria-pressed={pressed.includes(person.profile.id)}
              aria-label={person.label}
              onClick={() => filter.toggle(person.profile.id)}
              style={pillStyle(person.profile)}
              className={cn(PILL, 'justify-start gap-2.5 px-0 pr-3.5 pl-2 text-left selected:bg-person-soft focus-visible:-outline-offset-2')}
            >
              <PersonPill person={person} on={pressed.includes(person.profile.id)} />
            </Button>
          ),
        )}
      </div>
      {/* At the end of the row there is nothing more, so the button reads "Back" and returns to the first people: it is never
          switched off, so nobody is left at the far end of the row with no way back but a swipe they cannot know about, and the
          keyboard's focus never has to leave it. */}
      <OverflowButton control={more} of="people" className="max-[768px]:hidden" />
    </div>
  );
}

// The strip for the Wall's calendar screens. `profiles` are the Household's, null until they are read, and `routines`
// is the Wall's one reader of today's Routines, so the strip reads nothing of its own. While the Profiles are being
// read the row keeps its height, so the calendar under it does not move when they arrive; a Household with no
// Profiles has nothing to show.
export function PeopleStrip({ profiles, routines, filter, pressed }: { profiles: Profile[] | null; routines: RoutinesToday; filter: ProfileFilter; pressed: readonly string[] }) {
  if (profiles === null) return <div className="h-14 max-[768px]:h-13" />;
  if (profiles.length === 0) return null;
  return <Strip people={stripPeople(profiles, routines.groups, routines.done)} filter={filter} pressed={pressed} />;
}
