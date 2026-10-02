import { cn } from 'cn';
import {
  Backpack,
  Bath,
  Bed,
  Bike,
  Blocks,
  BookOpen,
  Brush,
  ChevronDown,
  Circle,
  Footprints,
  GlassWater,
  Moon,
  Music,
  PawPrint,
  Pencil,
  PersonStanding,
  Pill,
  ShowerHead,
  Shirt,
  Sparkles,
  Sprout,
  Toothbrush,
  Trash2,
  Utensils,
  Volleyball,
  WashingMachine,
  type LucideIcon,
} from 'lucide-react';
import { useId, useState } from 'react';

// The pictures a Routine can be given (docs/look.md, Routine pictures): the key stored in `routines.picture`, the words a
// screen reader says for it, and the icon it draws. In the order of that table; tests/routine-parts.test.ts holds this to
// the table through what the two components below draw. The database keeps no list: a key the app does not know, and none,
// draw a plain circle.
const ROUTINE_PICTURES: readonly { key: string; name: string; icon: LucideIcon }[] = [
  { key: 'teeth', name: 'Brush teeth', icon: Toothbrush },
  { key: 'shower', name: 'Shower', icon: ShowerHead },
  { key: 'bed', name: 'Bed', icon: Bed },
  { key: 'hair', name: 'Brush hair', icon: Brush },
  { key: 'dressed', name: 'Get dressed', icon: Shirt },
  { key: 'shoes', name: 'Shoes', icon: Footprints },
  { key: 'bag', name: 'School bag', icon: Backpack },
  { key: 'music', name: 'Music', icon: Music },
  { key: 'read', name: 'Reading', icon: BookOpen },
  { key: 'sport', name: 'Sport', icon: Volleyball },
  { key: 'homework', name: 'Homework', icon: Pencil },
  { key: 'bike', name: 'Bike', icon: Bike },
  { key: 'pet', name: 'Pet', icon: PawPrint },
  { key: 'laundry', name: 'Laundry', icon: WashingMachine },
  { key: 'plants', name: 'Plants', icon: Sprout },
  { key: 'tidy', name: 'Tidy up', icon: Sparkles },
  { key: 'toys', name: 'Toys', icon: Blocks },
  { key: 'medicine', name: 'Medicine', icon: Pill },
  { key: 'bins', name: 'Bins', icon: Trash2 },
  { key: 'water', name: 'Water', icon: GlassWater },
  { key: 'dishes', name: 'Dishes', icon: Utensils },
  { key: 'sleep', name: 'Sleep', icon: Moon },
  { key: 'bath', name: 'Bath', icon: Bath },
  { key: 'stretch', name: 'Stretch', icon: PersonStanding },
];

const known = new Map(ROUTINE_PICTURES.map((picture) => [picture.key, picture]));

// A Routine's picture, or a plain circle when it has none or one the app does not know. Decorative: the Routine's words
// are always beside it.
export function RoutinePicture({ picture, size = 28 }: { picture: string | null; size?: number }) {
  const Icon = (picture === null ? undefined : known.get(picture)?.icon) ?? Circle;
  return <Icon aria-hidden size={size} />;
}

// A choice of the grid: its radio is hidden and the choice shows as Selected (docs/look.md) when checked, with the fill, the
// ring and the weight, and the focus ring when it is reached by keyboard.
const CHOICE =
  'relative flex min-h-12 cursor-pointer items-center justify-center rounded-2xl bg-muted text-base font-medium has-[:checked]:bg-accent has-[:checked]:font-semibold has-[:checked]:ring-2 has-[:checked]:ring-foreground has-[:checked]:ring-inset has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring';

// The picture of a Routine on the phone's form: a row that says which it is, which opens the grid of them. Each is named
// for a screen reader, and "No picture" is one of them. Arrow keys move between them, as in any radio group. The form that
// owns the choice holds it; `about` names the Routine, so no two on a page share a label. Drawn inside a person (the class
// `person`), which gives the picture its colour.
export function PictureField({ about, picture, onChange }: { about: string; picture: string | null; onChange: (picture: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const group = useId();
  // A key this build does not know is kept as it is when the form is saved, and is not offered.
  const name = picture === null ? 'No picture' : (known.get(picture)?.name ?? 'Another picture');
  return (
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="group">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-2xl bg-muted px-3 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-person-fill text-person-strong">
          <RoutinePicture picture={picture} size={22} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm leading-[18px] text-muted-foreground">Picture for {about}</span>
          <span className="truncate text-[17px] leading-6">{name}</span>
        </span>
        <ChevronDown aria-hidden className="size-5 shrink-0 text-muted-foreground group-open:rotate-180" />
      </summary>
      <div role="radiogroup" aria-label={`Picture for ${about}`} className="grid grid-cols-[repeat(auto-fill,minmax(3rem,1fr))] gap-2 pt-2">
        <label className={cn(CHOICE, 'col-span-full justify-start gap-3 px-3')}>
          <input type="radio" name={group} value="" className="sr-only" checked={picture === null} onChange={() => onChange(null)} />
          <Circle aria-hidden className="size-6" />
          No picture
        </label>
        {ROUTINE_PICTURES.map(({ key, name: words, icon: Icon }) => (
          <label key={key} className={cn(CHOICE, 'aspect-square')}>
            <input type="radio" name={group} value={key} className="sr-only" aria-label={words} checked={picture === key} onChange={() => onChange(key)} />
            <Icon aria-hidden className="size-7" />
          </label>
        ))}
      </div>
    </details>
  );
}
