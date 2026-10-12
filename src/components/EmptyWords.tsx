import { cn } from 'cn';
import type { ReactNode } from 'react';

// What a screen says when it holds nothing, or is waiting for what it holds (docs/look.md, Empty states): one style, 16 px in
// --muted-foreground, a sentence and, where there is something to do about it, a clause with the way out ("No lists yet. Add one on your
// phone."). Where there is nothing to do ("Nothing scheduled today.") it is the sentence alone, and "Loading" is the waiting. `className` is
// for where it sits (its padding, its place in a row), never for how it looks.
export function EmptyWords({ children, className }: { children: ReactNode; className?: string | undefined }) {
  return <p className={cn('text-base text-muted-foreground', className)}>{children}</p>;
}
