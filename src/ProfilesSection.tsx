import { ArrowDown, ArrowUp } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  PROFILE_PALETTE,
  cleanAvatarUrl,
  createProfile,
  deleteProfile,
  loadProfiles,
  movedIds,
  nextSortOrder,
  paletteColorName,
  reorderProfiles,
  updateProfile,
  type Profile,
} from '@/lib/profiles';
import { supabase } from '@/lib/supabase';

const field = 'min-h-12 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground';
const action = 'min-h-12 rounded-lg px-4 text-base font-medium';
const iconAction = 'flex size-12 items-center justify-center rounded-lg border border-border disabled:opacity-40';

type Draft = { name: string; color: string; avatar: string };

const emptyDraft: Draft = { name: '', color: PROFILE_PALETTE[0].hex, avatar: '' };

// The fixed palette as a radio group: colour is never the only cue, each swatch
// is named and the chosen one carries a check mark and a ring.
function ColorPicker({ value, onChange, label }: { value: string; onChange: (hex: string) => void; label: string }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-base">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {PROFILE_PALETTE.map((color) => (
          <label
            key={color.hex}
            className="relative flex size-12 cursor-pointer items-center justify-center rounded-full has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-foreground"
            style={{ backgroundColor: color.hex, boxShadow: value === color.hex ? '0 0 0 3px #09090b, 0 0 0 6px #fafafa' : undefined }}
          >
            <input
              type="radio"
              name={`${label}-color`}
              className="sr-only"
              value={color.hex}
              checked={value === color.hex}
              onChange={() => onChange(color.hex)}
              aria-label={color.name}
            />
            {value === color.hex && (
              <span aria-hidden="true" className="text-xl font-bold text-zinc-950">
                ✓
              </span>
            )}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Swatch({ profile }: { profile: Profile }) {
  return (
    <span
      role="img"
      aria-label={`${paletteColorName(profile.color) ?? 'Custom'} colour`}
      className="size-12 shrink-0 rounded-full"
      style={{ backgroundColor: profile.color }}
    />
  );
}

// Settings, phone only: the Household's Profiles. Add, edit, reorder, and delete
// with a confirmation. A Device reads Profiles but never gets this screen.
export function ProfilesSection({ householdId }: { householdId: string }) {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [adding, setAdding] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState<{ id: string; draft: Draft } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setProfiles(await loadProfiles(supabase));
      setProblem(null);
    } catch {
      setProblem('Could not load Profiles. Check your connection.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Runs a write, then reloads so the screen shows what is saved either way.
  async function change(write: () => Promise<void>, failure: string): Promise<boolean> {
    try {
      await write();
      setProblem(null);
      await refresh();
      return true;
    } catch {
      setProblem(failure);
      await refresh();
      return false;
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    const ok = await change(
      () =>
        createProfile(
          supabase,
          householdId,
          { name: adding.name, color: adding.color, avatar_url: cleanAvatarUrl(adding.avatar) },
          nextSortOrder(profiles ?? []),
        ).then(() => undefined),
      'Could not add the Profile. Check the name and the picture address, then try again.',
    );
    if (ok) setAdding(emptyDraft);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    const { id, draft } = editing;
    const ok = await change(
      () => updateProfile(supabase, id, { name: draft.name, color: draft.color, avatar_url: cleanAvatarUrl(draft.avatar) }),
      'Could not save the Profile. Check the name and the picture address, then try again.',
    );
    if (ok) setEditing(null);
  }

  async function remove(id: string) {
    const ok = await change(() => deleteProfile(supabase, id), 'Could not delete the Profile. Try again.');
    if (ok) setConfirming(null);
  }

  async function move(id: string, offset: number) {
    const ids = movedIds((profiles ?? []).map((profile) => profile.id), id, offset);
    await change(() => reorderProfiles(supabase, ids), 'Could not reorder Profiles. Try again.');
  }

  return (
    <section aria-labelledby="profiles-heading" className="flex flex-col gap-4">
      <h2 id="profiles-heading" className="text-xl font-semibold">
        Profiles
      </h2>

      <form onSubmit={(event) => void add(event)} className="flex flex-col gap-4">
        <label className="flex flex-col gap-2 text-base">
          Name
          <input
            className={field}
            value={adding.name}
            onChange={(e) => setAdding({ ...adding, name: e.target.value })}
            maxLength={100}
            required
          />
        </label>
        <ColorPicker label="New Profile colour" value={adding.color} onChange={(color) => setAdding({ ...adding, color })} />
        <label className="flex flex-col gap-2 text-base">
          Picture address (optional, starts with https://)
          <input
            className={field}
            type="url"
            pattern="https://.*"
            inputMode="url"
            value={adding.avatar}
            onChange={(e) => setAdding({ ...adding, avatar: e.target.value })}
            placeholder="https://"
            autoComplete="off"
          />
        </label>
        <button type="submit" className={`${action} bg-primary text-primary-foreground`}>
          Add Profile
        </button>
      </form>

      <p role="status" className="min-h-6 text-base">
        {problem}
      </p>
      {profiles?.length === 0 && <p className="text-base">No Profiles yet.</p>}
      <ul className="flex flex-col gap-3">
        {profiles?.map((profile, index) => (
          <li key={profile.id} className="flex flex-col gap-3 rounded-lg border border-border p-3">
            {editing?.id === profile.id ? (
              <form onSubmit={(event) => void save(event)} className="flex flex-col gap-4">
                <label className="flex flex-col gap-2 text-base">
                  Name
                  <input
                    className={field}
                    autoFocus
                    value={editing.draft.name}
                    onChange={(e) => setEditing({ id: profile.id, draft: { ...editing.draft, name: e.target.value } })}
                    maxLength={100}
                    required
                  />
                </label>
                <ColorPicker
                  label={`${profile.name} colour`}
                  value={editing.draft.color}
                  onChange={(color) => setEditing({ id: profile.id, draft: { ...editing.draft, color } })}
                />
                <label className="flex flex-col gap-2 text-base">
                  Picture address (optional, starts with https://)
                  <input
                    className={field}
                    type="url"
                    pattern="https://.*"
                    inputMode="url"
                    value={editing.draft.avatar}
                    onChange={(e) => setEditing({ id: profile.id, draft: { ...editing.draft, avatar: e.target.value } })}
                    autoComplete="off"
                  />
                </label>
                <div className="flex gap-3">
                  <button type="submit" className={`${action} flex-1 bg-primary text-primary-foreground`}>
                    Save
                  </button>
                  <button type="button" className={`${action} border border-border`} onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <Swatch profile={profile} />
                  <p className="flex-1 text-base font-medium">{profile.name}</p>
                  <button type="button" className={iconAction} aria-label={`Move ${profile.name} up`} disabled={index === 0} onClick={() => void move(profile.id, -1)}>
                    <ArrowUp aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className={iconAction}
                    aria-label={`Move ${profile.name} down`}
                    disabled={index === profiles.length - 1}
                    onClick={() => void move(profile.id, 1)}
                  >
                    <ArrowDown aria-hidden="true" />
                  </button>
                </div>
                {confirming === profile.id ? (
                  <div className="flex gap-3">
                    <button type="button" autoFocus className={`${action} flex-1 border-2 border-destructive bg-primary text-primary-foreground`} onClick={() => void remove(profile.id)}>
                      Delete {profile.name}
                    </button>
                    <button type="button" className={`${action} border border-border`} onClick={() => setConfirming(null)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-3">
                    <button
                      type="button"
                      className={`${action} flex-1 border border-border`}
                      aria-label={`Edit ${profile.name}`}
                      onClick={() => setEditing({ id: profile.id, draft: { name: profile.name, color: profile.color, avatar: profile.avatar_url ?? '' } })}
                    >
                      Edit
                    </button>
                    <button type="button" className={`${action} flex-1 border border-border`} aria-label={`Delete ${profile.name}`} onClick={() => setConfirming(profile.id)}>
                      Delete
                    </button>
                  </div>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
