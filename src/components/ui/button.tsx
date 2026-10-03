import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';

// The one button (docs/look.md, The parts). Four voices: primary (--primary; one to a screen), secondary (--muted),
// quiet (no fill, --muted-foreground) and delete (--destructive). Two sizes: the Wall's and the phone's. Pressed, a
// button dips; secondary and quiet also take --accent, while primary and delete keep their fill so their words keep
// their contrast. Switched off it is 40% and cannot be tapped: `disabled`, or `aria-disabled` for a button that has or may have
// focus (one that is busy with the write it started), since a button that is disabled while it has focus drops it to the page.
// An aria-disabled button is drawn the same and does not dip, its handler ignores the press, and it still takes a tap, so the
// tap does not move the focus off it either. The focus ring is the base rule's in index.css, so
// there is none here. A button that is not a rectangle (a round switch, an icon over a word) sets its own shape
// with `className`, which wins over what is set here.
//
// Selected (--accent, a 2 px inset ring in --foreground, weight 600) is for secondary and quiet buttons that say so
// themselves: aria-pressed for a pill or a segmented control's choice, aria-checked for a radio, aria-selected for a tab,
// aria-current="page" for the current rail entry. `selected:` is the variant in index.css that answers all four.
// Nothing else to pass.
const selected = 'selected:bg-accent selected:font-semibold selected:text-foreground selected:ring-2 selected:ring-foreground selected:ring-inset';

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl text-base font-semibold whitespace-nowrap transition-[transform,background-color] duration-75 select-none active:translate-y-0.5 disabled:pointer-events-none disabled:opacity-40 aria-disabled:opacity-40 aria-disabled:active:translate-y-0 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-5',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground',
        secondary: `bg-secondary text-secondary-foreground active:bg-accent ${selected}`,
        quiet: `text-muted-foreground active:bg-accent ${selected}`,
        delete: 'bg-destructive text-destructive-foreground',
      },
      // 52 px on the Wall and 56 on the phone, both past the 48 px a finger needs.
      size: {
        wall: 'h-13 px-6',
        phone: 'h-14 px-5',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'wall' },
  },
);

// `type` is "button" unless said otherwise, so a button inside a form never submits it by accident. With `asChild`
// the button's look goes to the one element inside (a link, say) and `type` is left alone.
function Button({
  className,
  variant,
  size,
  asChild = false,
  type,
  ...props
}: ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Component = asChild ? Slot.Root : 'button';
  return <Component type={asChild ? type : (type ?? 'button')} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { Button };
