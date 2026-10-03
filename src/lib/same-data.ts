// Whether a read found anything new. The Wall reads on a timer (the Household, today's Routines: every 30 seconds), and a read that
// brings back what the screen already has must not be a new object, since a new object is a new render of everything below it.

// Whether two reads hold the same data: plain values that are equal, objects with the same fields, lists with the same items in the
// same order, Sets with the same members, however deep. Anything else (a Date, a Map, a class) is the same only when it is the very
// same value, so the answer is never wrongly yes; a wrong no is only a render.
export function sameData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (a instanceof Set && b instanceof Set) return a.size === b.size && [...a].every((member) => b.has(member));
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (!Array.isArray(a) && !(isPlain(a) && isPlain(b))) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => key in right && sameData(left[key], right[key]));
}

function isPlain(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// What a screen keeps of a read: the object it has when the read is the same data, else the read. Nothing held yet takes the read.
export function keepIfSame<T>(held: T | null, read: T): T {
  return held !== null && sameData(held, read) ? held : read;
}
