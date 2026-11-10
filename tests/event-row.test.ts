import { describe, expect, it } from 'vitest';
import { DEFAULT_TITLE, eventRow } from '@shared/event-row';

// Pure: facts in, the row out. Both providers hand their facts to this one builder, so the rules
// for a row (the default title, the caps, the instants, the refusals) are pinned here once.

const START = Date.parse('2026-10-05T10:00:00Z');
const END = Date.parse('2026-10-05T11:00:00Z');
const facts = { key: 'k', title: 'Dentist', notes: undefined, place: undefined, startsMs: START, endsMs: END, allDay: false };

describe('eventRow: the title', () => {
  it('names a missing, empty or blank title the default, and the default is "(No title)"', () => {
    expect(DEFAULT_TITLE).toBe('(No title)');
    for (const title of [undefined, null, '', '   ']) {
      expect(eventRow({ ...facts, title })?.title).toBe('(No title)');
    }
  });

  it('trims a title and keeps what is left', () => {
    expect(eventRow({ ...facts, title: '  Dentist ' })?.title).toBe('Dentist');
  });

  it('cuts a title to 500 characters after trimming', () => {
    expect(eventRow({ ...facts, title: `  ${'T'.repeat(600)}` })?.title).toBe('T'.repeat(500));
  });
});

describe('eventRow: the notes and the place', () => {
  it('cuts the notes to 8000 and the place to 500 characters', () => {
    const row = eventRow({ ...facts, notes: 'D'.repeat(9000), place: 'L'.repeat(600) });
    expect(row?.description).toBe('D'.repeat(8000));
    expect(row?.location).toBe('L'.repeat(500));
  });

  it('leaves absent or empty notes and place null', () => {
    expect(eventRow({ ...facts, notes: '', place: undefined })).toMatchObject({ description: null, location: null });
    expect(eventRow({ ...facts, notes: null, place: null })).toMatchObject({ description: null, location: null });
  });
});

describe('eventRow: the row', () => {
  it('keys the row by the key given, and writes the instants as ISO strings with all day', () => {
    expect(eventRow({ key: 'abc|2026-10-05T10:00:00.000Z', title: 'Dentist', notes: 'Bring card', place: 'Clinic', startsMs: START, endsMs: END, allDay: true })).toEqual({
      google_event_id: 'abc|2026-10-05T10:00:00.000Z',
      title: 'Dentist',
      description: 'Bring card',
      location: 'Clinic',
      starts_at: '2026-10-05T10:00:00.000Z',
      ends_at: '2026-10-05T11:00:00.000Z',
      is_all_day: true,
    });
  });

  it('refuses a bad instant', () => {
    expect(eventRow({ ...facts, startsMs: Number.NaN })).toBeNull();
    expect(eventRow({ ...facts, endsMs: Number.NaN })).toBeNull();
    expect(eventRow({ ...facts, endsMs: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it('refuses an end before the start, and keeps an end at the start', () => {
    expect(eventRow({ ...facts, startsMs: END, endsMs: START })).toBeNull();
    expect(eventRow({ ...facts, endsMs: START })).toMatchObject({ starts_at: '2026-10-05T10:00:00.000Z', ends_at: '2026-10-05T10:00:00.000Z' });
  });
});
