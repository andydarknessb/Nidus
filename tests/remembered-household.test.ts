import { describe, expect, it } from 'vitest';
import { gateWords, recallHousehold, rememberHousehold } from '../src/lib/remembered-household';

// What the Wall remembers of its Household on the Device, and the gate's words. A Storage-shaped
// object stands in for localStorage. No stack needed.

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const items = new Map(Object.entries(initial));
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
}

function throwingStorage(): Storage {
  const fail = () => {
    throw new Error('storage unavailable');
  };
  return { length: 0, clear: fail, getItem: fail, key: fail, removeItem: fail, setItem: fail };
}

describe('remembered Household', () => {
  it('reads back the name and Household Timezone that were remembered', () => {
    const storage = memoryStorage();
    rememberHousehold(storage, { name: 'The Andersons', timezone: 'America/Denver' });
    expect(recallHousehold(storage)).toEqual({ name: 'The Andersons', timezone: 'America/Denver' });
  });

  it('keeps only the newest Household read', () => {
    const storage = memoryStorage();
    rememberHousehold(storage, { name: 'Old', timezone: 'UTC' });
    rememberHousehold(storage, { name: 'New', timezone: 'Europe/Paris' });
    expect(recallHousehold(storage)).toEqual({ name: 'New', timezone: 'Europe/Paris' });
  });

  it('reads back null when nothing is remembered', () => {
    expect(recallHousehold(memoryStorage())).toBeNull();
  });

  it('reads back null for unreadable JSON or the wrong shape', () => {
    const key = 'nidus.household';
    for (const stored of ['{not json', 'null', '"text"', '{"name":"A"}', '{"name":1,"timezone":"UTC"}']) {
      expect(recallHousehold(memoryStorage({ [key]: stored }))).toBeNull();
    }
  });

  it('reads back null for a timezone the clock cannot use', () => {
    const storage = memoryStorage({ 'nidus.household': JSON.stringify({ name: 'A', timezone: 'Not/AZone' }) });
    expect(recallHousehold(storage)).toBeNull();
  });

  it('never throws when the storage does', () => {
    expect(() => rememberHousehold(throwingStorage(), { name: 'A', timezone: 'UTC' })).not.toThrow();
    expect(recallHousehold(throwingStorage())).toBeNull();
  });
});

describe('gate words', () => {
  it('say Connecting for fewer than three failed tries', () => {
    expect(gateWords(0)).toBe('Connecting');
    expect(gateWords(1)).toBe('Connecting');
    expect(gateWords(2)).toBe('Connecting');
  });

  it('say No internet. Trying again. from the third', () => {
    expect(gateWords(3)).toBe('No internet. Trying again.');
    expect(gateWords(10)).toBe('No internet. Trying again.');
  });
});
