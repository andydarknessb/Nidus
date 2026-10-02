import { ArrowDown, ArrowUp, Pencil, Plus } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ColorPicker, DeletePerson } from '@/components/PersonEditor';
import { PersonDisc } from '@/components/people';
import { Card, Field } from '@/components/phone';
import { Button } from '@/components/ui/button';
import { useRefetchOn } from '@/lib/change-feed';
import { createProfile, deleteProfile, firstFreeColor, loadProfiles, movedIds, nextSortOrder, reorderProfiles, updateProfile, type Profile } from '@/lib/profiles';
import { supabase } from '@/lib/supabase';

const PROFILE_TABLES = ['profiles'] as const;

type Control = 'edit' | 'delete' | 'up' | 'down';

// Ids for a row's buttons, so focus can go back to one after the screen swaps controls.
const controlId = (profileId: string, control: Control) => `profile-${profileId}-${control}`;
const ADD_ID = 'person-add';

// What the name field and the colour hold while a form is open. The picture address is not here: it left the form, and no write
// of a person names it.
type Draft = { name: string; color: string };
type Editing = { id: string; draft: Draft; deleting: boolean };

const nameField = 'h-14 w-full text-[17px]';

// A form's title: the disc the person will be, which follows the name and the colour as they are chosen, and what the form does.
function FormTitle({ draft, title }: { draft: Draft; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <PersonDisc name={draft.name} color={draft.color} size={44} />
      <h3 className="font-display text-[22px] leading-7">{title}</h3>
    </div>
  );
}

// Settings, phone only: the Household's people (Profiles). Each is a row with a pencil, which opens the person to change their
// name and colour, move them up or down, or delete them; a new person starts on the first colour nobody has. A Device reads
// Profiles but never gets this screen.
export function ProfilesSection({ householdId }: { householdId: string }) {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [adding, setAdding] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busy, setBusy] = useState(false);
  const [focusNext, setFocusNext] = useState<string | null>(null);

  // Moves focus once the control it names is on screen; the swap unmounts whatever had it.
  useEffect(() => {
    if (focusNext === null) return;
    document.getElementById(focusNext)?.focus();
    setFocusNext(null);
  }, [focusNext]);

  const refresh = useCallback(async () => {
    try {
      setProfiles(await loadProfiles(supabase));
      setProblem(null);
    } catch {
      setProblem('Could not load people. Check your connection.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useRefetchOn(PROFILE_TABLES, () => void refresh());

  // Runs a write, then reloads so the screen shows what is saved either way. One at a time: a second tap waits for the first.
  async function change(write: () => Promise<void>, failure: string): Promise<boolean> {
    setBusy(true);
    try {
      await write();
      setProblem(null);
      await refresh();
      return true;
    } catch {
      setProblem(failure);
      await refresh();
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!adding || busy) return;
    const ok = await change(
      () => createProfile(supabase, householdId, adding, nextSortOrder(profiles ?? [])).then(() => undefined),
      'Could not add the person. Check the name and try again.',
    );
    if (ok) {
      setAdding(null);
      setFocusNext(ADD_ID);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing || busy) return;
    const { id, draft } = editing;
    const ok = await change(() => updateProfile(supabase, id, draft), 'Could not save the person. Check the name and try again.');
    if (ok) {
      setEditing(null);
      setFocusNext(controlId(id, 'edit'));
    }
  }

  async function remove(id: string) {
    const ok = await change(() => deleteProfile(supabase, id), 'Could not delete the person. Try again.');
    if (ok) {
      setEditing(null);
      setFocusNext(ADD_ID);
    }
  }

  async function move(id: string, offset: number) {
    const ids = movedIds((profiles ?? []).map((profile) => profile.id), id, offset);
    const at = ids.indexOf(id);
    // Moving a row takes the button just pressed with it, or switches it off at an end: the focus goes to whichever is there.
    const atEnd = (at === 0 && offset < 0) || (at === ids.length - 1 && offset > 0);
    const ok = await change(() => reorderProfiles(supabase, ids), 'Could not reorder people. Try again.');
    if (ok) setFocusNext(controlId(id, (offset < 0) !== atEnd ? 'up' : 'down'));
  }

  return (
    <Card title="People">
      {problem && (
        <p role="alert" className="text-base">
          {problem}
        </p>
      )}
      {profiles?.length === 0 && <p className="text-base">No one yet. Add the people who live here.</p>}
      <ul className="flex flex-col gap-2">
        {profiles?.map((profile, index) => (
          <li key={profile.id}>
            {editing?.id === profile.id ? (
              <div className="flex flex-col gap-4 border-y border-border py-4">
                {editing.deleting ? (
                  <DeletePerson
                    name={profile.name}
                    busy={busy}
                    onCancel={() => {
                      setEditing({ ...editing, deleting: false });
                      setFocusNext(controlId(profile.id, 'delete'));
                    }}
                    onDelete={() => void remove(profile.id)}
                  />
                ) : (
                  <>
                    <form onSubmit={(event) => void save(event)} className="flex flex-col gap-4">
                      <FormTitle draft={editing.draft} title={`Edit ${profile.name}`} />
                      <Field label="Name">
                        <input
                          className={nameField}
                          autoFocus
                          value={editing.draft.name}
                          onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, name: e.target.value } })}
                          maxLength={100}
                          required
                        />
                      </Field>
                      <ColorPicker value={editing.draft.color} profiles={profiles} onChange={(color) => setEditing({ ...editing, draft: { ...editing.draft, color } })} />
                      <div className="flex gap-2">
                        <Button
                          variant="quiet"
                          size="phone"
                          className="flex-1"
                          onClick={() => {
                            setEditing(null);
                            setFocusNext(controlId(profile.id, 'edit'));
                          }}
                        >
                          Cancel
                        </Button>
                        <Button type="submit" variant="secondary" size="phone" className="flex-1" disabled={busy}>
                          Save person
                        </Button>
                      </div>
                    </form>
                    <div className="flex gap-2">
                      <Button id={controlId(profile.id, 'up')} variant="quiet" size="phone" className="flex-1" disabled={index === 0 || busy} onClick={() => void move(profile.id, -1)}>
                        <ArrowUp aria-hidden />
                        Move up
                      </Button>
                      <Button
                        id={controlId(profile.id, 'down')}
                        variant="quiet"
                        size="phone"
                        className="flex-1"
                        disabled={index === profiles.length - 1 || busy}
                        onClick={() => void move(profile.id, 1)}
                      >
                        <ArrowDown aria-hidden />
                        Move down
                      </Button>
                    </div>
                    <Button
                      id={controlId(profile.id, 'delete')}
                      variant="quiet"
                      size="phone"
                      className="h-auto min-h-14 py-2 whitespace-normal"
                      onClick={() => setEditing({ ...editing, deleting: true })}
                    >
                      Delete {profile.name}
                    </Button>
                  </>
                )}
              </div>
            ) : (
              <div className="flex h-14 items-center gap-3 rounded-2xl bg-muted pr-1 pl-1.5">
                <PersonDisc name={profile.name} color={profile.color} size={44} />
                <span className="min-w-0 flex-1 truncate text-[17px] font-medium">{profile.name}</span>
                <Button
                  id={controlId(profile.id, 'edit')}
                  variant="quiet"
                  aria-label={`Edit ${profile.name}`}
                  className="size-12 rounded-full p-0"
                  onClick={() => setEditing({ id: profile.id, draft: { name: profile.name, color: profile.color }, deleting: false })}
                >
                  <Pencil aria-hidden className="size-[22px]" />
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {adding ? (
        <form onSubmit={(event) => void add(event)} className="flex flex-col gap-4 border-t border-border pt-4">
          <FormTitle draft={adding} title="New person" />
          <Field label="Name">
            <input className={nameField} autoFocus value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} maxLength={100} required />
          </Field>
          <ColorPicker value={adding.color} profiles={profiles ?? []} onChange={(color) => setAdding({ ...adding, color })} />
          <div className="flex gap-2">
            <Button
              variant="quiet"
              size="phone"
              className="flex-1"
              onClick={() => {
                setAdding(null);
                setFocusNext(ADD_ID);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="secondary" size="phone" className="flex-1" disabled={busy}>
              Add person
            </Button>
          </div>
        </form>
      ) : (
        <Button id={ADD_ID} variant="secondary" size="phone" className="w-full" disabled={profiles === null} onClick={() => setAdding({ name: '', color: firstFreeColor(profiles ?? []) })}>
          <Plus aria-hidden />
          Add a person
        </Button>
      )}
    </Card>
  );
}
