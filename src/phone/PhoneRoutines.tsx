import { cn } from 'cn';
import { Star } from 'lucide-react';
import { useRef, useState } from 'react';
import { BeforeHousehold } from '../components/BeforeHousehold';
import { EmptyWords } from '../components/EmptyWords';
import { MAX_PIPS, PersonDisc, Pips } from '../components/people';
import { Button } from '../components/ui/button';
import { personStyle } from '../lib/look';
import { CHART_CHOICES, WORDS, useChartPart } from '../lib/routine-chart';
import { pickedPerson, partView, routineProgress, tapFinishesProfile, type Burst, type ChartPart, type ProfileRoutines, type Routine } from '../lib/routines';
import { stripPeople, type StripPerson } from '../lib/schedule';
import { useCelebration } from '../lib/use-routines-today';
import type { PhoneScreenProps } from '../PhoneWall';
import { Confetti, DoneEarlier, PartGroups } from '../RoutinesPage';
import { Segmented, SideScroll } from './parts';
import { couldNotLoad } from '../lib/synced-read';

// The phone's Routines tab (docs/specs/0004-the-wall-on-a-phone.md, Screens; docs/look.md, "The phone"): one person at a time. A
// row of the people the chart has a column for, each with their progress in words; the chart's own control for the part of the day;
// and the picked person's card, which draws what the chart's column draws (its tiles, headings, "Left from earlier" and the foot
// line are the chart's own pieces) in one column that the document scrolls. Ticking goes through the Wall's one reader of today's
// Routines, as the chart's does.

const PARTS_OF_THE_DAY = CHART_CHOICES.map(({ part, label }) => ({ value: part, label }));

// A person in the row: a 56 px button on their soft colour with their 40 px disc, their name and their progress in words ("3 of 5",
// "All done"). Pressed, it keeps its colour and takes the ring (`selected:`), so the choice is never told by colour alone.
function PersonChip({ person, picked, onPick }: { person: StripPerson; picked: boolean; onPick: () => void }) {
  const { profile, words, total } = person;
  return (
    <Button
      variant="quiet"
      aria-pressed={picked}
      aria-label={person.label}
      onClick={onPick}
      style={personStyle(profile.color)}
      className="person h-14 max-w-48 min-w-32 justify-start gap-2.5 rounded-[18px] bg-person-soft px-0 pr-3.5 pl-2 text-left text-foreground selected:bg-person-soft focus-visible:-outline-offset-2"
    >
      <PersonDisc name={profile.name} color={profile.color} size={40} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-base leading-5 font-semibold">{profile.name}</span>
        <span className={cn('truncate text-sm leading-[18px]', words === 'All done' ? 'font-semibold' : 'text-muted-foreground')}>{total === 0 ? 'Nothing today' : words}</span>
      </span>
    </Button>
  );
}

// The picked person's card on their soft colour: their 52 px disc and name, how far they are, their pips, then what the part shows.
export function PersonCard({
  column,
  part,
  held,
  done,
  problem,
  onToggle,
  burst,
  onFinish,
  onLand,
}: {
  column: ProfileRoutines;
  part: ChartPart;
  held: ReadonlySet<string>;
  done: Set<string>;
  // What the last tick of this person's that did not save says; empty when it was saved.
  problem: string | undefined;
  onToggle: (routine: Routine) => Promise<boolean>;
  burst: Burst | undefined;
  // A tap here finished the person, `at` px down the card; the burst's last piece has landed.
  onFinish: (at: number) => void;
  onLand: (id: number) => void;
}) {
  const { profile, routines } = column;
  const { done: count, total } = routineProgress(routines, done);
  const finished = total > 0 && count === total;
  // With more Routines than pips, the count is all that says how far along they are, so it is read out.
  const pips = total > 0 && total <= MAX_PIPS;
  const view = part === 'whole' ? null : partView(routines, done, part, held);
  const card = useRef<HTMLElement>(null);

  function tap(routine: Routine, button: HTMLElement) {
    if (card.current && tapFinishesProfile(routines, done, routine.id, !done.has(routine.id))) {
      // Where the burst starts: the middle of the tile, measured from the card's padding edge, which is the burst's own top.
      const box = button.getBoundingClientRect();
      onFinish(box.top + box.height / 2 - (card.current.getBoundingClientRect().top + card.current.clientTop));
    }
    void onToggle(routine);
  }

  return (
    <section ref={card} aria-labelledby={`routines-${profile.id}`} className="person relative flex flex-col gap-2.5 rounded-[22px] bg-person-soft p-3" style={personStyle(profile.color)}>
      <div className="flex min-h-13 items-center gap-3">
        <PersonDisc name={profile.name} color={profile.color} size={52} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 id={`routines-${profile.id}`} dir="auto" className={cn(WORDS, 'line-clamp-2 font-display text-[26px] leading-[30px]')}>
            {profile.name}
          </h3>
          <div className="flex items-center gap-1.5 text-[15px] leading-5">
            {total === 0 && <span className="text-muted-foreground">Nothing today</span>}
            {total > 0 && !finished && (
              <span aria-hidden={pips || undefined} className="text-muted-foreground">
                {count} of {total} done
              </span>
            )}
            {/* Always on the page, so a screen reader hears "All done" when it appears and not when Routines load already done. */}
            <span role="status" className="flex items-center gap-1.5 font-semibold">
              {finished && (
                <>
                  <span className="sr-only">{profile.name}: </span>
                  <Star aria-hidden className="size-4 shrink-0" />
                  All done
                </>
              )}
            </span>
          </div>
        </div>
      </div>
      <Pips done={count} total={total} label={`${profile.name}: ${count} of ${total} ${total === 1 ? 'routine' : 'routines'} done`} color={profile.color} height={10} />
      {total > 0 && <PartGroups profile={profile} routines={routines} done={done} part={part} view={view} finished={finished} onTap={tap} />}
      {view !== null && <DoneEarlier view={view} color={profile.color} />}
      {problem && (
        <p role="alert" className="px-1 text-[15px] leading-5">
          {problem}
        </p>
      )}
      {burst !== undefined && <Confetti key={burst.id} at={burst.at} onDone={() => onLand(burst.id)} />}
    </section>
  );
}

export function PhoneRoutines({ timezone, view, routines }: Pick<PhoneScreenProps, 'timezone' | 'view' | 'routines'>) {
  const { loaded, settled, failed, problems, columns, done, toggle } = routines;
  const { shown, held, pick } = useChartPart(routines);
  // The person picked: the first pick, then whoever is tapped. State, so a tick that finishes someone never moves the card.
  const [picked, setPicked] = useState<string | null>(null);
  const showing = pickedPerson({ picked, columns, done, part: shown, settled, failed });
  if (showing !== picked && showing !== null) setPicked(showing);
  // A burst belongs to the card on the screen: the one for a person left behind is gone, so it never plays again on the way back.
  const celebration = useCelebration({ date: routines.date, finished: new Set(showing !== null && routines.finished.has(showing) ? [showing] : []) });

  if (!timezone) return <BeforeHousehold label="Routines" failed={view.failed} words={couldNotLoad('routines')} />;

  const column = columns.find(({ profile }) => profile.id === showing);
  const people = stripPeople(
    columns.map(({ profile }) => profile),
    columns,
    done,
  );

  return (
    <section aria-labelledby="phone-routines-title" className="flex flex-col gap-3">
      <h2 id="phone-routines-title" className="sr-only">
        Routines
      </h2>
      {!loaded && !failed && <EmptyWords>Loading</EmptyWords>}
      {/* Whatever has been read stays on screen over a lost connection, and the header says so. With nothing read for today (at the
          start, or just after Household midnight) the words say so rather than leave "Loading" for ever. */}
      {failed && !settled && (
        <p role="alert" className="text-base">
          {couldNotLoad('routines')}
        </p>
      )}
      {loaded && columns.length === 0 && <EmptyWords>No routines yet. The owner adds them in Settings.</EmptyWords>}
      {columns.length > 0 && (
        <>
          <SideScroll label="People">
            {people.map((person) => (
              <PersonChip key={person.profile.id} person={person} picked={person.profile.id === column?.profile.id} onPick={() => setPicked(person.profile.id)} />
            ))}
          </SideScroll>
          <Segmented label="Part of the day" options={PARTS_OF_THE_DAY} value={shown} onChange={pick} />
          {column ? (
            <PersonCard
              key={column.profile.id}
              column={column}
              part={shown}
              held={held}
              done={done}
              problem={problems[column.profile.id]}
              onToggle={toggle}
              burst={celebration.bursts[column.profile.id]}
              onFinish={(at) => celebration.start(column.profile.id, at)}
              onLand={(id) => celebration.land(column.profile.id, id)}
            />
          ) : (
            !failed && <EmptyWords>Loading</EmptyWords>
          )}
        </>
      )}
    </section>
  );
}
