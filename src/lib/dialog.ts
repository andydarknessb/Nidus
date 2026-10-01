import type { KeyboardEvent } from 'react';

// Keys for a modal sheet: Escape closes it, and Tab and Shift+Tab stay inside it (aria-modal)
// instead of reaching the page behind. Put on the dialog element, which holds focus on open.
export function dialogKeys(event: KeyboardEvent<HTMLElement>, onClose: () => void): void {
  if (event.key === 'Escape') onClose();
  if (event.key !== 'Tab') return;
  const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])')];
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) {
    event.preventDefault();
  } else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
