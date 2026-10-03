import { useEffect } from 'react';

// A page names itself in the document's title ("Week | Nidus") and the title goes back to "Nidus" when the page is gone,
// so a screen reader hears where a tap on the navigation rail has taken it.
export function useDocumentTitle(page: string): void {
  useEffect(() => {
    document.title = `${page} | Nidus`;
    return () => {
      document.title = 'Nidus';
    };
  }, [page]);
}
