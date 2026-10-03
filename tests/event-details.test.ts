import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EventDetails } from '../src/components/EventDetails';
import type { Occurrence } from '../src/lib/calendar-occurrences';
import type { Profile } from '../src/lib/profiles';
import { pillPeople } from '../src/lib/schedule';

// An event's details rendered to markup, so what is asserted is what the browser is given: who the event is for (by name, or
// "Everyone"), where it lives and so where to change it, and the controls that follow from that.

const CHICAGO = 'America/Chicago';
const profile = (id: string, name: string, sort: number, color: string): Profile => ({ id, name, color, avatar_url: null, sort_order: sort });
const FAMILY = [profile('p-cory', 'Cory', 0, '#93c5fd'), profile('p-sam', 'Sam', 1, '#f9a8d4'), profile('p-ava', 'Ava', 2, '#fcd34d'), profile('p-ben', 'Ben', 3, '#6ee7b7')];

function event(more: Partial<Occurrence> = {}): Occurrence {
  return {
    source: 'synced',
    id: 'event-1',
    calendar_id: 'calendar-1',
    calendar_name: 'Family',
    title: 'Piano',
    description: null,
    location: null,
    // 4:00 PM to 4:45 PM on Oct 1, Chicago.
    starts_at: '2026-10-01T21:00:00Z',
    ends_at: '2026-10-01T21:45:00Z',
    is_all_day: false,
    profile_id: null,
    profile_ids: [],
    ...more,
  };
}

function render(occurrence: Occurrence, options: { profiles?: Profile[]; edit?: boolean } = {}): string {
  const { profiles = FAMILY, edit = true } = options;
  return renderToStaticMarkup(
    createElement(EventDetails, {
      occurrence,
      timezone: CHICAGO,
      people: pillPeople(occurrence, profiles),
      onClose: () => undefined,
      ...(edit ? { onEdit: () => undefined } : {}),
    }),
  );
}
// The words of the sheet, without its markup.
const words = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

describe('who an event is for', () => {
  it('is the name of one person, with their disc and their fill', () => {
    const html = render(event({ profile_ids: ['p-ava'] }));
    expect(words(html)).toContain('Who A Ava');
    expect(html).toContain('bg-person-fill');
    expect(html).not.toContain('bg-everyone');
  });

  it('is every name of two, three and four people, in the order of the Profiles', () => {
    expect(words(render(event({ profile_ids: ['p-ben', 'p-ava'] })))).toContain('Ava and Ben');
    expect(words(render(event({ profile_ids: ['p-ava', 'p-cory', 'p-sam'] })))).toContain('Cory, Sam and Ava');
    // More than a pill has discs for: the sheet still names all of them.
    const five = [...FAMILY, profile('p-emma', 'Emma', 4, '#c4b5fd')];
    expect(words(render(event({ profile_ids: ['p-cory', 'p-sam', 'p-ava', 'p-ben'] }), { profiles: five }))).toContain('Cory, Sam, Ava and Ben');
  });

  it('is "Everyone" for the whole Household, with the house disc and not a Profile\'s colour', () => {
    for (const ids of [[], ['p-cory', 'p-sam', 'p-ava', 'p-ben']]) {
      const html = render(event({ profile_ids: ids }));
      expect(words(html)).toContain('Everyone');
      expect(html).toContain('bg-everyone');
      expect(html).not.toContain('bg-person-fill');
    }
  });
});

describe('where an event lives', () => {
  it('says a Synced Event is from Google Calendar and is changed there, and offers no Edit', () => {
    const html = render(event());
    expect(words(html)).toContain('From Google Calendar. Change it there.');
    expect(words(html)).not.toContain('Added here');
    expect(words(html)).toContain('Calendar Family');
    expect(words(html)).not.toContain('Edit');
  });

  it('says a Native Event was added here and is not in Google Calendar, and offers Edit', () => {
    const html = render(event({ source: 'native', calendar_id: null, calendar_name: 'Nidus' }));
    expect(words(html)).toContain('Added here. Not in Google Calendar.');
    expect(words(html)).not.toContain('From Google Calendar');
    expect(words(html)).toContain('Edit');
    // The calendar's name is for an event that came from one.
    expect(words(html)).not.toContain('Nidus');
  });

  it('offers no Edit for a Native Event when nothing can edit it', () => {
    expect(words(render(event({ source: 'native', calendar_id: null, calendar_name: 'Nidus' }), { edit: false }))).not.toContain('Edit');
  });
});

describe('the sheet', () => {
  it('is a dialog named by the event, with a Close button that is 48 px', () => {
    const html = render(event());
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="event-details-title"');
    expect(html).toContain('<h2 id="event-details-title"');
    expect(html).toContain('aria-label="Close"');
    expect(/<button[^>]*aria-label="Close"[^>]*>/.exec(html)?.[0]).toMatch(/class="[^"]*\bsize-12\b/);
  });

  it('says when, and where and the notes only when it has them', () => {
    expect(words(render(event()))).toContain('When Thu, Oct 1, 4:00 PM to 4:45 PM');
    expect(words(render(event()))).not.toContain('Where');
    expect(words(render(event()))).not.toContain('Notes');
    const full = words(render(event({ location: '1204 Maple Street', description: 'Bring the chairs.' })));
    expect(full).toContain('Where 1204 Maple Street');
    expect(full).toContain('Notes Bring the chairs.');
  });

  it('draws a description as plain text, never as markup', () => {
    const html = render(event({ description: '<b>bold</b> <script>alert(1)</script>' }));
    expect(html).not.toContain('<b>bold</b>');
    expect(html).not.toContain('<script>');
    // It is there, as text.
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;');
  });

  it('keeps to the look: Young Serif for the title with no weight put on it, and no em or en dash', () => {
    const html = render(event({ location: 'Maple Street', description: 'Chairs.' }));
    expect(html).toMatch(/<h2[^>]*class="[^"]*\bfont-display\b[^"]*"/);
    expect(html).not.toMatch(/<h2[^>]*class="[^"]*\bfont-(semibold|bold)\b/);
    expect(html).not.toMatch(/[\u2013\u2014]/);
  });
});
