import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Draws `children` as a child of the document's body, outside the app's own tree in the page: a sheet drawn here is what the page is read
// through while everything behind it is inert (holdBackground), which it could not be if it stood inside what is made inert. Where there is
// no document (a test that renders to markup) it is drawn where it stands.
export function InBody({ children }: { children: ReactNode }) {
  return typeof document === 'undefined' ? children : createPortal(children, document.body);
}
