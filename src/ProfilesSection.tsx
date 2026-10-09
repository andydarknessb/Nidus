import { ArrowDown, ArrowUp, Pencil, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { DeletePerson, PersonFields, type PersonDraft } from '@/components/PersonEditor';
import { PersonDisc } from '@/components/people';
import { Card, Problem, buttonHalf, buttonRow } from '@/components/phone';
import { Button } from '@/components/ui/button';
import { createProfile, deleteProfile, firstFreeColor, loadProfiles, reorderProfiles, updateProfile } from '@/lib/profiles';
import { movedIds, nextSortOrder } from '@/lib/ordering';
import { supabase } from '@/lib/supabase';
import { useCardWrite } from '@/lib/use-card-write';
import { useWriteProblem } from '@/lib/use-write-problem';
import { giveName } from '@/lib/write-failure';
import { couldNotLoad, useSyncedRead } from '@/lib/synced-read';

const PROFILE_TABLES = ['profiles'] as const;

type Control = 'edit' | 'delete' | 'up' | 'down';

// Ids for a row's buttons, so focus can go back to one after the screen swaps controls.
const controlId = (profileId: string, control: Control) => `profile-${profileId}-${control}`;
const ADD_ID = 'person-add';

// Where a write that failed says so: in the form to add, in the panel of the person being changed (a save), under its two move
// buttons, or in the question about deleting them. Each has the id its sentence is tied to.
const ADD = 'add';
const editPlace = (id: string) => `edit-${id}`;
const movePlace = (id: string) => `move-${id}`;
const deletePlace = (id: string) => `delete-${id}`;
const problemId = (place: string) => `problem-${place}`;

type Editing = { id: string; draft: PersonDraft; deleting: boolean };

// A form's title: the disc the person will be, which follows the name and the colour as they are chosen, and what the form does.
function FormTitle({ draft, title }: { draft: PersonDraft; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <PersonDisc name={draft.name} color={draft.color} size={44} />
      <h3 className="min-w-0 font-display text-[22px] leading-7 break-words">{title}</h3>
    </div>
  );
}

// Settings, phone only: the Household's people (Profiles). Each is a row with a pencil, which opens the person to change their
// name and colour, move them up or down, or delete them; a new person starts on the first colour nobody has. A Device reads
// Profiles but never gets this screen.
export function ProfilesSection({ householdId }: { householdId: string }) {
  // Read through the synced read. A trouble reading, which a read that works takes away, is kept apart from what a write said of
  // itself: a good read says nothing of it.
  const read = useSyncedRead(() => loadProfiles(supabase), PROFILE_TABLES, 'profiles');
  const profiles = read.data;
  const loadProblem = read.failed ? couldNotLoad('people') : null;
  const problems = useWriteProblem();
  const [adding, setAdding] = useState<PersonDraft | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  // One write at a time (the card write guard): the card draws `aria-disabled` from `busy`, and says where focus goes afterwards.
  const card = useCardWrite(problems);
  const { busy } = card;

  // Runs a write. While it is on its way the buttons are `aria-disabled` and do nothing, never `disabled`: a button that is
  // disabled while it has focus drops it to the page. What an earlier try said stays where it is until this one answers, so that
  // nothing moves under the finger. A write that fails says so at once, in `place`, and the screen is read again in its own time
  // (offline that read tries for seconds, and the person is not waiting on it). A write that lands is read back before the form
  // closes, so what it shows is what is stored; `landed` is what the card then does, and returns where focus goes.
  async function change(place: string, write: () => Promise<void>, landed: () => string | void, refusal?: string) {
    await card.run(
      async () => {
        await read.write(write);
        problems.clear(place);
        await read.readBack();
      },
      { place, words: refusal === undefined ? {} : { refusal }, landed },
    );
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!adding) return;
    if (!adding.name.trim()) {
      problems.say(ADD, giveName('person'), true);
      return;
    }
    await change(
      ADD,
      () => createProfile(supabase, householdId, adding, nextSortOrder(profiles ?? [])).then(() => undefined),
      () => {
        setAdding(null);
        return ADD_ID;
      },
      'Could not add the person. Check the name and try again.',
    );
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    const { id, draft } = editing;
    if (!draft.name.trim()) {
      problems.say(editPlace(id), giveName('person'), true);
      return;
    }
    await change(
      editPlace(id),
      () => updateProfile(supabase, id, draft),
      () => {
        setEditing(null);
        return controlId(id, 'edit');
      },
      'Could not save the person. Check the name and try again.',
    );
  }

  async function remove(id: string) {
    await change(
      deletePlace(id),
      () => deleteProfile(supabase, id),
      () => {
        setEditing(null);
        return ADD_ID;
      },
    );
  }

  async function move(id: string, offset: number) {
    const ids = movedIds((profiles ?? []).map((profile) => profile.id), id, offset);
    // Moving a row moves its elements in the page, and a focused one loses the focus in the move: it goes back to the button pressed.
    await change(movePlace(id), () => reorderProfiles(supabase, ids), () => controlId(id, offset < 0 ? 'up' : 'down'));
  }

  // Opening or closing a form, or a question, takes away what a write said in another one.
  const closeForms = () => problems.clear();
  // While a write is on its way nothing that changes what is open does anything either: its answer would land on the wrong form.
  const off = busy || undefined;
  // What a form's place says, except "Give the person a name." once the name is given: a refusal for want of a name is not said over one.
  const saidAt = (place: string, name: string) => {
    const problem = problems.at(place);
    return problem?.words === giveName('person') && name.trim() !== '' ? null : problem;
  };
  const addProblem = saidAt(ADD, adding?.name ?? '');

  return (
    <Card title="People">
      {loadProblem && (
        <p role="alert" className="text-base">
          {loadProblem}
        </p>
      )}
      {profiles?.length === 0 && <p className="text-base">No one yet. Add the people who live here.</p>}
      <ul className="flex flex-col gap-2">
        {profiles?.map((profile, index) => {
          const editProblem = saidAt(editPlace(profile.id), editing?.id === profile.id ? editing.draft.name : '');
          return (
            <li key={profile.id}>
              {editing?.id === profile.id ? (
                <div className="flex flex-col gap-4 border-y border-border py-4">
                  {editing.deleting ? (
                    <DeletePerson
                      name={profile.name}
                      busy={busy}
                      problem={problems.at(deletePlace(profile.id))}
                      onCancel={() => {
                        closeForms();
                        setEditing({ ...editing, deleting: false });
                        card.focus(controlId(profile.id, 'delete'));
                      }}
                      onDelete={() => void remove(profile.id)}
                    />
                  ) : (
                    <>
                      <form onSubmit={(event) => void save(event)} noValidate className="flex flex-col gap-4">
                        <FormTitle draft={editing.draft} title={`Edit ${profile.name}`} />
                        <PersonFields
                          draft={editing.draft}
                          profiles={profiles}
                          problem={editProblem ? { id: problemId(editPlace(profile.id)), refused: editProblem.refused } : undefined}
                          onChange={(draft) => setEditing({ ...editing, draft })}
                        />
                        <div className={buttonRow}>
                          <Button
                            variant="quiet"
                            size="phone"
                            className={buttonHalf}
                            aria-disabled={off}
                            onClick={() => {
                              if (busy) return;
                              closeForms();
                              setEditing(null);
                              card.focus(controlId(profile.id, 'edit'));
                            }}
                          >
                            Cancel
                          </Button>
                          <Button type="submit" variant="secondary" size="phone" className={buttonHalf} aria-disabled={busy || undefined}>
                            Save person
                          </Button>
                        </div>
                        <Problem id={problemId(editPlace(profile.id))} problem={editProblem} />
                      </form>
                      <div className="flex flex-col gap-2">
                        <div className={buttonRow}>
                          <Button
                            id={controlId(profile.id, 'up')}
                            variant="quiet"
                            size="phone"
                            className={buttonHalf}
                            aria-disabled={index === 0 || busy || undefined}
                            onClick={() => {
                              if (index !== 0 && !busy) void move(profile.id, -1);
                            }}
                          >
                            <ArrowUp aria-hidden />
                            Move up
                          </Button>
                          <Button
                            id={controlId(profile.id, 'down')}
                            variant="quiet"
                            size="phone"
                            className={buttonHalf}
                            aria-disabled={index === profiles.length - 1 || busy || undefined}
                            onClick={() => {
                              if (index !== profiles.length - 1 && !busy) void move(profile.id, 1);
                            }}
                          >
                            <ArrowDown aria-hidden />
                            Move down
                          </Button>
                        </div>
                        <Problem id={problemId(movePlace(profile.id))} problem={problems.at(movePlace(profile.id))} />
                      </div>
                      <Button
                        id={controlId(profile.id, 'delete')}
                        variant="quiet"
                        size="phone"
                        className="h-auto min-h-14 py-2 whitespace-normal [overflow-wrap:anywhere]"
                        aria-disabled={off}
                        onClick={() => {
                          if (busy) return;
                          closeForms();
                          setEditing({ ...editing, deleting: true });
                        }}
                      >
                        Delete {profile.name}
                      </Button>
                    </>
                  )}
                </div>
              ) : (
                <div className="flex h-14 items-center gap-3 rounded-[14px] bg-muted pr-1 pl-1.5">
                  <PersonDisc name={profile.name} color={profile.color} size={44} />
                  <span className="min-w-0 flex-1 truncate text-[17px] font-medium">{profile.name}</span>
                  <Button
                    id={controlId(profile.id, 'edit')}
                    variant="quiet"
                    aria-label={`Edit ${profile.name}`}
                    className="size-12 rounded-full p-0"
                    aria-disabled={off}
                    onClick={() => {
                      if (busy) return;
                      closeForms();
                      setEditing({ id: profile.id, draft: { name: profile.name, color: profile.color }, deleting: false });
                    }}
                  >
                    <Pencil aria-hidden className="size-[22px]" />
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {adding ? (
        <form onSubmit={(event) => void add(event)} noValidate className="flex flex-col gap-4 border-t border-border pt-4">
          <FormTitle draft={adding} title="New person" />
          <PersonFields
            draft={adding}
            profiles={profiles ?? []}
            problem={addProblem ? { id: problemId(ADD), refused: addProblem.refused } : undefined}
            onChange={setAdding}
          />
          <div className={buttonRow}>
            <Button
              variant="quiet"
              size="phone"
              className={buttonHalf}
              aria-disabled={off}
              onClick={() => {
                if (busy) return;
                closeForms();
                setAdding(null);
                card.focus(ADD_ID);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="secondary" size="phone" className={buttonHalf} aria-disabled={busy || undefined}>
              Add person
            </Button>
          </div>
          <Problem id={problemId(ADD)} problem={addProblem} />
        </form>
      ) : (
        <Button
          id={ADD_ID}
          variant="secondary"
          size="phone"
          className="w-full"
          aria-disabled={profiles === null || busy || undefined}
          onClick={() => {
            if (profiles === null || busy) return;
            closeForms();
            setAdding({ name: '', color: firstFreeColor(profiles) });
          }}
        >
          <Plus aria-hidden />
          Add a person
        </Button>
      )}
    </Card>
  );
}
