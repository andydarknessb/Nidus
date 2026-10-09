// Position (spec 0008): how Profiles, Routines, Shared Lists and their items are put in order, moved and appended. Rows carry a
// `sort_order`; the screen shows them by it. Plain functions, so every list of rows that can be reordered reads one rule.

// Order the way the screen shows it: by position (the server breaks ties by age).
export function byPosition<T extends { sort_order: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.sort_order - b.sort_order);
}

// New rows go to the bottom.
export function nextSortOrder(rows: { sort_order: number }[]): number {
  return rows.reduce((max, row) => Math.max(max, row.sort_order), -1) + 1;
}

// The ids in their new order after moving `id` by `offset` places (clamped to the ends).
export function movedIds(ids: string[], id: string, offset: number): string[] {
  const from = ids.indexOf(id);
  if (from < 0) return ids;
  const to = Math.min(Math.max(from + offset, 0), ids.length - 1);
  const next = ids.filter((existing) => existing !== id);
  next.splice(to, 0, id);
  return next;
}
