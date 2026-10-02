import { describe, expect, it } from 'vitest';
import { PROFILE_PALETTE, colorOwners, eventPeople, firstFreeColor, namesInWords } from '../src/lib/profiles';

// The phone's settings (spec 0003, People): what is pure about them. The first free colour, whose a colour is, and who an event is
// for. What the database does with a Profile's picture address is in tests/profiles.test.ts, which needs the local stack.

const hexes = PROFILE_PALETTE.map((color) => color.hex);
const hex = (index: number) => hexes[index]!;
const people = (...colors: string[]) => colors.map((color) => ({ color }));

describe('the colour a new person starts on', () => {
  it('is the first colour of the palette when nobody has any', () => {
    expect(firstFreeColor([])).toBe(hex(0));
  });

  it('is the first colour nobody has, so a gap is filled before the end is extended', () => {
    expect(firstFreeColor(people(hex(0), hex(1)))).toBe(hex(2));
    expect(firstFreeColor(people(hex(1)))).toBe(hex(0));
    expect(firstFreeColor(people(hex(0), hex(2), hex(3)))).toBe(hex(1));
    expect(firstFreeColor(people(...hexes.slice(0, 9)))).toBe(hex(9));
  });

  it('is the one the fewest people have once all ten are taken, palette order breaking ties', () => {
    const everyone = people(...hexes);
    // Ten people, one colour each: all tied, so the first.
    expect(firstFreeColor(everyone)).toBe(hex(0));
    // The first is twice taken: the next of the ties.
    expect(firstFreeColor([...everyone, ...people(hex(0))])).toBe(hex(1));
    expect(firstFreeColor([...everyone, ...people(hex(0), hex(1), hex(2))])).toBe(hex(3));
    // Wherever the least shared one is, it is the one: every colour twice but the ninth.
    expect(firstFreeColor([...everyone, ...people(...hexes.filter((_, index) => index !== 8))])).toBe(hex(8));
    // Two people on one colour and one on every other: the first of those on one.
    expect(firstFreeColor([...everyone, ...people(hex(0), hex(0))])).toBe(hex(1));
  });

  it('counts a colour stored in capitals as the same colour', () => {
    expect(firstFreeColor(people(hex(0).toUpperCase()))).toBe(hex(1));
    expect(firstFreeColor([...people(...hexes.map((color) => color.toUpperCase())), ...people(hex(0))])).toBe(hex(1));
  });

  it('does not count a colour that is not in the palette', () => {
    expect(firstFreeColor(people('#123456', '#fe0000'))).toBe(hex(0));
  });

  it('is always one of the ten', () => {
    for (let count = 0; count <= 25; count += 1) {
      const everyone = Array.from({ length: count }, (_, index) => ({ color: hex(index % 10) }));
      expect(hexes, `${count} people`).toContain(firstFreeColor(everyone));
    }
  });
});

describe('whose a colour is', () => {
  const cory = { id: 'p1', name: 'Cory', color: hex(7) };
  const sam = { id: 'p2', name: 'Sam', color: hex(9) };
  const alex = { id: 'p3', name: 'Alex', color: hex(7).toUpperCase() };

  it('lists the people who have it, in their order', () => {
    expect(colorOwners([cory, sam, alex], hex(7))).toEqual([cory, alex]);
    expect(colorOwners([cory, sam], hex(0))).toEqual([]);
  });

  it('names people for a sentence', () => {
    expect(namesInWords([])).toBe('');
    expect(namesInWords(['Cory'])).toBe('Cory');
    expect(namesInWords(['Cory', 'Sam'])).toBe('Cory and Sam');
    expect(namesInWords(['Cory', 'Sam', 'Ava'])).toBe('Cory, Sam and Ava');
  });
});

describe('who an event is for', () => {
  const [cory, sam, ava] = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }];

  it('is everyone when it names nobody', () => {
    expect(eventPeople([], [cory, sam, ava])).toEqual({ everyone: true, people: [] });
  });

  it('is the people it names, in the order of the people and not of the event', () => {
    expect(eventPeople(['p3', 'p1'], [cory, sam, ava])).toEqual({ everyone: false, people: [cory, ava] });
  });

  it('is everyone when it names every person of a Household of two or more', () => {
    expect(eventPeople(['p2', 'p1', 'p3'], [cory, sam, ava])).toEqual({ everyone: true, people: [] });
    expect(eventPeople(['p1', 'p2'], [cory, sam])).toEqual({ everyone: true, people: [] });
  });

  it('is that person when it names the only person of a Household', () => {
    expect(eventPeople(['p1'], [cory])).toEqual({ everyone: false, people: [cory] });
  });

  it('is nobody drawn, and not everyone, while the people are not read yet', () => {
    expect(eventPeople(['p1'], [])).toEqual({ everyone: false, people: [] });
  });
});
