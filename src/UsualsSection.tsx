import { Pencil, Plus, X } from 'lucide-react';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Card, Field, Problem, buttonHalf, buttonRow, fieldClass } from '@/components/phone';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useFormRow } from '@/lib/use-form-row';
import { useUsuals } from '@/lib/use-usuals';
import { USUAL_EMPTY, createUsual, deleteUsual, updateUsual, usualProblem, type Usual, type UsualInput } from '@/lib/usuals';
import { problemId } from '@/lib/write-failure';

// Settings, phone only: the Household's Usuals (spec 0019, ticket 4). Each is a row with its product, "Target link" when it has one,
// and Edit and Delete named for it; Edit swaps the row for the form, and "Add a usual" opens the same form at the foot. Only a Household
// Account gets this card: a Device reads them through the Send to Target sheet and never writes.

const ADD = 'add';
const ADD_ID = 'usual-add';
const editPlace = (id: string) => `edit-${id}`;
const deletePlace = (id: string) => `delete-${id}`;

// The id of a row's Edit or Delete, so focus can go back to it when the form closes.
const usualControlId = (id: string, control: 'edit' | 'delete') => `usual-${id}-${control}`;

const blank: UsualInput = { name: '', product: '', target_link: '' };

// The three fields of a Usual, in the form's order. `describedBy` points the fields at the line that says what is wrong with them.
export function UsualFields({ draft, describedBy, onChange }: { draft: UsualInput; describedBy?: string | undefined; onChange: (draft: UsualInput) => void }) {
  const set = (field: keyof UsualInput) => (event: ChangeEvent<HTMLInputElement>) => onChange({ ...draft, [field]: event.target.value });
  return (
    <>
      <Field label="Name">
        <input className={fieldClass} autoComplete="off" maxLength={60} value={draft.name} onChange={set('name')} aria-describedby={describedBy} />
      </Field>
      <Field label="Product">
        <input className={fieldClass} autoComplete="off" maxLength={200} value={draft.product} onChange={set('product')} aria-describedby={describedBy} />
      </Field>
      <Field label="Target link (optional)">
        <input className={fieldClass} type="url" autoComplete="off" maxLength={500} value={draft.target_link} onChange={set('target_link')} aria-describedby={describedBy} />
      </Field>
    </>
  );
}

// One Usual as a row: its name, its product, and "Target link" when it has one, with Edit and Delete (48 px) named for it.
export function UsualRow({ usual, busy, onEdit, onDelete }: { usual: Usual; busy: boolean; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex min-h-14 items-center gap-2 rounded-[14px] bg-muted py-1 pr-1 pl-3">
      <div className="min-w-0 flex-1">
        <p className="text-[17px] font-medium wrap-anywhere">{usual.name}</p>
        <p className="text-[15px] leading-5 wrap-anywhere text-muted-foreground">{usual.product}</p>
        {usual.target_link && <p className="text-[15px] leading-5 text-muted-foreground">Target link</p>}
      </div>
      <Button
        id={usualControlId(usual.id, 'edit')}
        variant="quiet"
        aria-label={`Edit ${usual.name}`}
        aria-disabled={busy || undefined}
        className="size-12 shrink-0 rounded-full p-0"
        onClick={() => {
          if (!busy) onEdit();
        }}
      >
        <Pencil aria-hidden className="size-[22px]" />
      </Button>
      <Button
        id={usualControlId(usual.id, 'delete')}
        variant="quiet"
        aria-label={`Delete ${usual.name}`}
        aria-disabled={busy || undefined}
        className="size-12 shrink-0 rounded-full p-0"
        onClick={() => {
          if (!busy) onDelete();
        }}
      >
        <X aria-hidden className="size-[22px]" />
      </Button>
    </div>
  );
}

export function UsualsSection({ householdId }: { householdId: string }) {
  // One change at a time (the card write guard): while one is on its way the buttons are `aria-disabled` and do nothing. A problem is
  // said in its place; a save that lands closes its form and reads the Usuals back.
  const read = useUsuals();
  const { busy, change } = read;
  const usuals = read.data;
  const [adding, setAdding] = useState<UsualInput | null>(null);
  const [editing, setEditing] = useState<{ id: string; draft: UsualInput } | null>(null);
  const addRow = useFormRow({ what: 'usual', place: () => ADD, read, opener: () => ADD_ID });
  const editRow = useFormRow({ what: 'usual', place: (id) => editPlace(id), read, opener: (id) => usualControlId(id, 'edit') });
  const off = busy || undefined;
  // Opening or closing a form takes away what a write said in another one.
  const closeForms = () => read.clear();

  // The form's own check (usualProblem) runs before the write, and says its words in the form's line. A blank name is the form row's:
  // usualProblem leaves it, and submit counts the ask.
  async function add(event: FormEvent) {
    event.preventDefault();
    if (!adding) return;
    const said = usualProblem(adding, usuals ?? [], null);
    if (said) {
      read.say(ADD, said);
      return;
    }
    await addRow.submit(adding.name, () => createUsual(supabase, householdId, adding), {
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
    const said = usualProblem(draft, usuals ?? [], id);
    if (said) {
      read.say(editPlace(id), said);
      return;
    }
    await editRow.submit(draft.name, () => updateUsual(supabase, id, draft), {
      landed: () => {
        editRow.close();
        setEditing(null);
      },
    });
  }

  async function remove(usual: Usual) {
    await change(deletePlace(usual.id), () => deleteUsual(supabase, usual.id), { landed: () => ADD_ID });
  }

  const addProblem = addRow.nameProblem(adding?.name ?? '') ?? read.problem(ADD);

  return (
    <Card title="Usuals" read={read} of="usuals">
      {usuals?.length === 0 && <p className="text-base">{USUAL_EMPTY}</p>}
      <ul className="flex flex-col gap-2">
        {usuals?.map((usual) => {
          const place = editPlace(usual.id);
          const isEditing = editing?.id === usual.id;
          const editProblem = isEditing ? (editRow.nameProblem(editing.draft.name) ?? read.problem(place)) : null;
          return (
            <li key={usual.id}>
              {isEditing ? (
                <form onSubmit={(event) => void save(event)} noValidate className="flex flex-col gap-4 border-y border-border py-4">
                  <h3 className="font-display text-[22px] leading-7 wrap-anywhere">Edit {usual.name}</h3>
                  <UsualFields draft={editing.draft} describedBy={editProblem ? problemId(place) : undefined} onChange={(draft) => setEditing({ id: usual.id, draft })} />
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
                    <Button type="submit" variant="secondary" size="phone" className={buttonHalf} aria-disabled={off}>
                      Save usual
                    </Button>
                  </div>
                  <Problem id={problemId(place)} problem={editProblem} />
                </form>
              ) : (
                <>
                  <UsualRow
                    usual={usual}
                    busy={busy}
                    onEdit={() => {
                      closeForms();
                      editRow.start(usual.id);
                      setEditing({ id: usual.id, draft: { name: usual.name, product: usual.product, target_link: usual.target_link ?? '' } });
                    }}
                    onDelete={() => void remove(usual)}
                  />
                  <Problem id={problemId(deletePlace(usual.id))} problem={read.problem(deletePlace(usual.id))} />
                </>
              )}
            </li>
          );
        })}
      </ul>

      {adding ? (
        <form onSubmit={(event) => void add(event)} noValidate className="flex flex-col gap-4 border-t border-border pt-4">
          <h3 className="font-display text-[22px] leading-7">New usual</h3>
          <UsualFields draft={adding} describedBy={addProblem ? problemId(ADD) : undefined} onChange={setAdding} />
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
            <Button type="submit" variant="secondary" size="phone" className={buttonHalf} aria-disabled={off}>
              Add usual
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
          aria-disabled={usuals === null || busy || undefined}
          onClick={() => {
            if (usuals === null || busy) return;
            closeForms();
            addRow.start('add');
            setAdding(blank);
          }}
        >
          <Plus aria-hidden />
          Add a usual
        </Button>
      )}
    </Card>
  );
}
