import { ArrowDown, ArrowUp, Pencil, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { DeletePerson, PersonFields, type PersonDraft } from '@/components/PersonEditor';
import { PersonDisc } from '@/components/people';
import { Card, Problem, buttonHalf, buttonRow } from '@/components/phone';
import { Button } from '@/components/ui/button';
import { createProfile, deleteProfile, firstFreeColor, loadProfiles, reorderProfiles, updateProfile } from '@/lib/profiles';
import { movedIds, nextSortOrder } from '@/lib/ordering';
import { supabase } from '@/lib/supabase';
import { problemId } from '@/lib/write-failure';
import { useSyncedRead } from '@/lib/synced-read';
import { useFormRow } from '@/lib/use-form-row';

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
  // One change at a time (read.change, the card write guard): while one is on its way the buttons are `aria-disabled` and do nothing,
  // never `disabled`, since a button that is disabled while it has focus drops it to the page; the card draws that from `busy`. A
  // change that fails says so at once, in its place; one that lands is read back before the form closes, and `landed` returns where
  // focus goes.
  const read = useSyncedRead(() => loadProfiles(supabase), PROFILE_TABLES, 'profiles');
  const { busy, change } = read;
  const profiles = read.data;
  const [adding, setAdding] = useState<PersonDraft | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  // The two forms' lifecycles (form-row.ts): their asks, their places and where focus goes when they close.
  const addRow = useFormRow({ what: 'person', place: () => ADD, read, opener: () => ADD_ID });
  const editRow = useFormRow({ what: 'person', place: (id) => editPlace(id), read, opener: (id) => controlId(id, 'edit') });

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!adding) return;
    await addRow.submit(adding.name, () => createProfile(supabase, householdId, adding, nextSortOrder(profiles ?? [])), {
      words: { refusal: 'Could not add the person. Check the name and try again.' },
      landed: () => {
        addRow.close();
        setAdding(null);
      },
    });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    const { id, draft } = editing;
    await editRow.submit(draft.name, () => updateProfile(supabase, id, draft), {
      words: { refusal: 'Could not save the person. Check the name and try again.' },
      landed: () => {
        editRow.close();
        setEditing(null);
      },
    });
  }

  async function remove(id: string) {
    await change(deletePlace(id), () => deleteProfile(supabase, id), {
      landed: () => {
        setEditing(null);
        return ADD_ID;
      },
    });
  }

  async function move(id: string, offset: number) {
    const ids = movedIds((profiles ?? []).map((profile) => profile.id), id, offset);
    // Moving a row moves its elements in the page, and a focused one loses the focus in the move: it goes back to the button pressed.
    await change(movePlace(id), () => reorderProfiles(supabase, ids), { landed: () => controlId(id, offset < 0 ? 'up' : 'down') });
  }

  // Opening or closing a form, or a question, takes away what a write said in another one.
  const closeForms = () => read.clear();
  // While a write is on its way nothing that changes what is open does anything either: its answer would land on the wrong form.
  const off = busy || undefined;
  // What the add form says: the name it wants (form-row.ts), else what its write said.
  const addProblem = addRow.nameProblem(adding?.name ?? '') ?? read.problem(ADD);

  return (
    <Card title="People" read={read} of="people">
      {profiles?.length === 0 && <p className="text-base">No one yet. Add the people who live here.</p>}
      <ul className="flex flex-col gap-2">
        {profiles?.map((profile, index) => {
          const editProblem = editing?.id === profile.id ? (editRow.nameProblem(editing.draft.name) ?? read.problem(editPlace(profile.id))) : null;
          return (
            <li key={profile.id}>
              {editing?.id === profile.id ? (
                <div className="flex flex-col gap-4 border-y border-border py-4">
                  {editing.deleting ? (
                    <DeletePerson
                      name={profile.name}
                      busy={busy}
                      problem={read.problem(deletePlace(profile.id))}
                      onCancel={() => {
                        closeForms();
                        setEditing({ ...editing, deleting: false });
                        read.focus(controlId(profile.id, 'delete'));
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
                          problem={editProblem ? { id: problemId(editPlace(profile.id)), refused: !('refused' in editProblem) || editProblem.refused === true } : undefined}
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
                              editRow.close();
                              setEditing(null);
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
                        <Problem id={problemId(movePlace(profile.id))} problem={read.problem(movePlace(profile.id))} />
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
                      editRow.start(profile.id);
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
            problem={addProblem ? { id: problemId(ADD), refused: !('refused' in addProblem) || addProblem.refused === true } : undefined}
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
                addRow.close();
                setAdding(null);
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
            addRow.start('add');
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
