import { describe, expect, it } from 'vitest';
import type { Occurrence } from '../src/lib/calendar-occurrences';
import { tint } from '../src/lib/event-tint';

function occurrence(colors: string[], color: string | null = colors[0] ?? null): Occurrence {
  return {
    source: 'synced',
    id: 'event-1',
    calendar_id: 'calendar-1',
    calendar_name: 'Family',
    title: 'Dentist',
    description: null,
    location: null,
    starts_at: '2026-10-01T16:00:00Z',
    ends_at: '2026-10-01T17:00:00Z',
    is_all_day: false,
    profile_id: null,
    color,
    profile_ids: [],
    colors,
  };
}

describe('tint', () => {
  it('colours the edge of an event and washes its ground in the same colour', () => {
    expect(tint(occurrence(['#93c5fd']))).toEqual({ borderLeftColor: '#93c5fd', backgroundColor: 'color-mix(in srgb, #93c5fd 24%, #18181b)' });
  });

  it('gives an event with no colour a neutral edge', () => {
    expect(tint(occurrence([], null))).toMatchObject({ borderLeftColor: '#d4d4d8' });
  });

  it('splits the edge of an event for several Profiles into a stripe of each colour, 8 px wide by default', () => {
    const style = tint(occurrence(['#93c5fd', '#f9a8d4']));
    expect(style.borderLeftColor).toBe('transparent');
    expect(style.backgroundImage).toContain('linear-gradient(to bottom, #93c5fd 0% 50%, #f9a8d4 50% 100%)');
    expect(style.backgroundSize).toBe('8px 100%, 100% 100%');
  });

  it('draws the stripes as wide as the edge it is given', () => {
    // The month's lines have a 4 px edge, so an 8 px stripe would reach into the text beside it.
    expect(tint(occurrence(['#93c5fd', '#f9a8d4']), 4).backgroundSize).toBe('4px 100%, 100% 100%');
    expect(tint(occurrence(['#93c5fd', '#f9a8d4']), 8)).toEqual(tint(occurrence(['#93c5fd', '#f9a8d4'])));
  });

  it('has no stripe to size for an event with one colour', () => {
    expect(tint(occurrence(['#93c5fd']), 4)).toEqual(tint(occurrence(['#93c5fd'])));
  });
});
