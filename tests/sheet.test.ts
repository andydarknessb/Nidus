import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { EventDetails } from '../src/components/EventDetails';
import type { NativeEventSheet as NativeEventSheetType } from '../src/components/NativeEventSheet';
import { BODY_CLEARANCE } from '../src/components/OverflowButton';
import { Sheet, SheetBody } from '../src/components/Sheet';
import type { Occurrence } from '../src/lib/calendar-occurrences';
import { pillPeople } from '../src/lib/schedule';
import type { OverflowControl } from '../src/lib/use-overflow';
import { elementAt, scrollers } from './support/markup';

// The frame every sheet over the Wall shares (docs/look.md, A sheet and Overflow): the title row and the footer stay in view, and the
// body between them is what scrolls, with the shared foot button over its end when it does. A Zoom invite is 15 to 30 lines of notes,
// a cluster can be a dozen events and a family of ten fills the Add event sheet's people: none of them may push the footer off the
// screen with no sign. Rendered to markup, so what is asserted is what the browser is given; that the footer is in view at 1280 x 800
// and 1280 x 720, and that the foot works, is looked at in the browser.

// What a body's scrolling box says, as the hook would hand it over (markup is made without the browser's measuring).
const says = (overflowing = false, atEnd = false): OverflowControl => ({ axis: 'y', overflowing, atEnd, scroller: () => undefined, piece: () => undefined, step: () => undefined });

describe("a sheet's body", () => {
  const draw = (control: OverflowControl) => renderToStaticMarkup(createElement(SheetBody, { title: 'Piano', control, children: createElement('p', null, 'Bring the chairs.') }));
  // The box that scrolls, and inside it the wrapper the content is in.
  const box = (html: string) => scrollers(html)[0] ?? '';
  const wrapper = (html: string) => elementAt(html, html.indexOf('<div', 1));

  it('is the one box that scrolls, with its content in a wrapper and nothing but its foot after it', () => {
    const html = draw(says(true));
    expect(scrollers(html)).toHaveLength(1);
    expect(box(html)).toMatch(/^<div[^>]*class="[^"]*\bmin-h-0\b/);
    expect(wrapper(html)).toContain('Bring the chairs.');
    expect(box(html).indexOf('sticky')).toBeGreaterThan(box(html).indexOf('Bring the chairs.'));
    expect(box(html).endsWith('</button></div></div>')).toBe(true);
  });

  it('says it scrolls with the shared foot button, named for the sheet: "More of Piano", and "Back to the top of Piano" at the end', () => {
    expect(draw(says(true))).toContain('aria-label="More of Piano"');
    expect(draw(says(true, true))).toContain('aria-label="Back to the top of Piano"');
    expect(draw(says(true, true))).not.toContain('aria-label="More of Piano"');
  });

  it('draws no foot when it holds all it has', () => {
    const html = draw(says());
    expect(html).not.toContain('aria-label="More of');
    expect(html).not.toContain('sticky');
  });

  it('lets everything in it be scrolled clear of the foot, which is not in what it is clear of', () => {
    const html = draw(says(true));
    // (A class in markup says & as &amp;.)
    expect(wrapper(html)).toContain(BODY_CLEARANCE.replace(/&/g, '&amp;'));
    expect(wrapper(html)).not.toContain('aria-label="More of');
    // The box itself keeps no scroll padding: the foot's own button taking the focus would move the box.
    expect(box(html)).not.toMatch(/^<div[^>]*class="[^"]*\bscroll-p/);
  });

  it('keeps its foot for the Wall: below 960 px a sheet is one column on a phone, which scrolls by touch', () => {
    expect(draw(says(true))).toMatch(/class="[^"]*\bsticky\b[^"]*\bmax-\[959px\]:hidden\b/);
  });
});

describe('a sheet', () => {
  const draw = () =>
    renderToStaticMarkup(
      createElement(Sheet, {
        labelledBy: 'piano-title',
        title: 'Piano',
        onClose: () => undefined,
        className: 'max-w-[640px]',
        header: createElement('header', null, createElement('h2', { id: 'piano-title' }, 'Piano')),
        footer: createElement('footer', null, 'From Google Calendar. Change it there.'),
        children: createElement('p', null, 'Bring the chairs.'),
      }),
    );

  it('is a dialog that does not scroll itself: only its body does', () => {
    const html = draw();
    expect(/<div[^>]*role="dialog"[^>]*>/.exec(html)?.[0]).not.toContain('overflow-y-auto');
    expect(scrollers(html)).toHaveLength(1);
    expect(/<div[^>]*role="dialog"[^>]*>/.exec(html)?.[0]).toMatch(/class="[^"]*\bmax-h-full\b[^"]*\bmin-h-0\b/);
  });

  it('keeps its title row above the box that scrolls and its footer below it, so neither leaves the screen', () => {
    const html = draw();
    const [box] = scrollers(html);
    expect(box).toContain('Bring the chairs.');
    expect(box).not.toContain('Piano');
    expect(box).not.toContain('From Google Calendar');
    expect(html.indexOf('<header')).toBeLessThan(html.indexOf(box!));
    expect(html.indexOf('<footer')).toBeGreaterThanOrEqual(html.indexOf(box!) + box!.length);
  });
});

describe('event details with a long note', () => {
  const CHICAGO = 'America/Chicago';
  const event = (more: Partial<Occurrence> = {}): Occurrence => ({
    source: 'synced',
    id: 'event-1',
    calendar_id: 'calendar-1',
    calendar_name: 'Family',
    title: 'Zoom: planning',
    description: null,
    location: null,
    starts_at: '2026-10-01T21:00:00Z',
    ends_at: '2026-10-01T21:45:00Z',
    is_all_day: false,
    profile_id: null,
    profile_ids: [],
    ...more,
  });
  // An invite: forty lines.
  const notes = Array.from({ length: 40 }, (_, line) => `Line ${line + 1} of the invite`).join('\n');
  const draw = (occurrence: Occurrence, edit = false) =>
    renderToStaticMarkup(createElement(EventDetails, { occurrence, timezone: CHICAGO, people: pillPeople(occurrence, []), onClose: () => undefined, ...(edit ? { onEdit: () => undefined } : {}) }));

  it('holds the notes in the box that scrolls, whole, and the footer after it', () => {
    const html = draw(event({ description: notes }));
    const [box] = scrollers(html);
    expect(scrollers(html)).toHaveLength(1);
    expect(box).toContain('Line 1 of the invite');
    expect(box).toContain('Line 40 of the invite');
    expect(box).not.toContain('From Google Calendar. Change it there.');
    expect(html.indexOf('From Google Calendar. Change it there.')).toBeGreaterThan(html.indexOf(box!) + box!.length - 1);
  });

  it('keeps Edit on a Native Event with the footer, outside the box, and the title and Close above it', () => {
    const html = draw(event({ source: 'native', calendar_id: null, calendar_name: 'Nidus', description: notes }), true);
    const [box] = scrollers(html);
    expect(box).not.toContain('Edit');
    expect(box).not.toContain('Close');
    expect(box).not.toContain('Zoom: planning');
    expect(html.indexOf('Edit</button>')).toBeGreaterThan(html.indexOf(box!) + box!.length - 1);
    expect(html.indexOf('aria-label="Close"')).toBeLessThan(html.indexOf(box!));
  });

  it('names the foot for the event: "More of Zoom: planning"', () => {
    // The foot is drawn once the box is measured to overflow; its words are the shared ones for a column, named for the sheet.
    expect(renderToStaticMarkup(createElement(SheetBody, { title: 'Zoom: planning', control: says(true), children: null }))).toContain('aria-label="More of Zoom: planning"');
  });
});

describe('the Add event sheet, as it is first drawn', () => {
  let NativeEventSheet: typeof NativeEventSheetType;
  beforeAll(async () => {
    // It imports the Supabase client, which is built on import and not used to draw: a placeholder URL and key are enough.
    vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
    ({ NativeEventSheet } = await import('../src/components/NativeEventSheet'));
  });
  const draw = () => renderToStaticMarkup(createElement(NativeEventSheet, { timezone: 'America/Chicago', date: '2026-10-02', onSaved: () => undefined, onClose: () => undefined }));

  it('keeps its title row above the box that scrolls and its footer below it, with its fields, whoever they are for, between', () => {
    const html = draw();
    const [box] = scrollers(html);
    expect(scrollers(html)).toHaveLength(1);
    expect(box).toContain('What is it?');
    expect(box).toContain('Who is it for?');
    expect(box).toContain('Notes (optional)');
    expect(box).not.toContain('New event');
    expect(box).not.toContain('aria-label="Close"');
    expect(box).not.toContain('Cancel');
    expect(html.indexOf('id="native-event-title"')).toBeLessThan(html.indexOf(box!));
    expect(html.indexOf('Cancel')).toBeGreaterThan(html.indexOf(box!) + box!.length - 1);
  });
});
