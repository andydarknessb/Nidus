import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { EventDetails } from '../src/components/EventDetails';
import type { NativeEventSheet as NativeEventSheetType } from '../src/components/NativeEventSheet';
import { BODY_CLEARANCE } from '../src/components/OverflowButton';
import { PHONE_FRAME, PHONE_SCRIM, Sheet, SheetBody } from '../src/components/Sheet';
import type { Occurrence } from '../src/lib/calendar-occurrences';
import type { Profile } from '../src/lib/profiles';
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
  const draw = (profiles: Profile[] = []) =>
    renderToStaticMarkup(createElement(NativeEventSheet, { timezone: 'America/Chicago', profiles, date: '2026-10-02', onSaved: () => undefined, onClose: () => undefined }));

  it('offers a chip for each Profile it is handed, on the first draw, and only Everyone when it is handed none', () => {
    const profile = (id: string, name: string, sort: number): Profile => ({ id, name, color: '#93c5fd', avatar_url: null, sort_order: sort });
    const html = draw([profile('p-cory', 'Cory', 0), profile('p-sam', 'Sam', 1)]);
    expect(html).toContain('Cory');
    expect(html).toContain('Sam');
    expect(draw()).not.toContain('Cory');
    expect(draw()).toContain('Everyone');
  });

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

// A sheet on a phone (docs/specs/0004, Sheets): below 768 px it rises from the foot, full width, 24 round at the top only, at most the
// screen's height less 24 px, with a handle, its foot clear of the safe area. One frame (PHONE_FRAME, PHONE_SCRIM, SheetHandle) is drawn
// for all three of the Wall's dialogs. Rendered to markup, so what is asserted is the classes the browser is given: the phone's are
// all `phone:` variants, so at 768 px and wider the classes that apply are the ones each sheet always had.
describe('a sheet on a phone', () => {
  const tag = (html: string, pattern: RegExp) => pattern.exec(html)?.[0] ?? '';
  const dialogOf = (html: string) => tag(html, /<(?:div|form)[^>]*role="dialog"[^>]*>/);
  const scrimOf = (html: string) => tag(html, /<div[^>]*class="[^"]*\bfixed\b[^"]*"[^>]*>/);
  const handleOf = (html: string) => tag(html, /<span[^>]*data-sheet-handle[^>]*>/);
  const drawSheet = () =>
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
  // Every class of the phone frame is in the element's class list.
  const classesOf = (element: string) => (/class="([^"]*)"/.exec(element)?.[1] ?? '').split(/\s+/).filter(Boolean);
  const hasFrame = (element: string, frame: string) => {
    const own = classesOf(element);
    return frame.split(' ').every((name) => own.includes(name));
  };

  it('draws the shared phone frame on Sheet, on the scrim and on the dialog, with the handle first inside the dialog', () => {
    const html = drawSheet();
    expect(hasFrame(scrimOf(html), PHONE_SCRIM)).toBe(true);
    expect(hasFrame(dialogOf(html), PHONE_FRAME)).toBe(true);
    expect(html.indexOf(handleOf(html))).toBeGreaterThan(html.indexOf(dialogOf(html)));
    expect(html.indexOf(handleOf(html))).toBeLessThan(html.indexOf('<header'));
  });

  it('is full width, rounded at the top only, at most the screen less 24 px, with the foot clear of the safe area', () => {
    expect(PHONE_FRAME).toContain('phone:max-w-none');
    expect(PHONE_FRAME).toContain('phone:rounded-t-3xl');
    expect(PHONE_FRAME).toContain('phone:rounded-b-none');
    expect(PHONE_FRAME).toContain('phone:max-h-[calc(100%-24px)]');
    expect(PHONE_FRAME).toContain('env(safe-area-inset-bottom)');
    expect(PHONE_SCRIM).toContain('phone:items-end');
    expect(PHONE_SCRIM).toContain('phone:p-0');
  });

  it('has a 40 by 4 px handle in --input that assistive technology skips, and none of it shows at 768 px and wider', () => {
    const handle = handleOf(drawSheet());
    expect(handle).toContain('aria-hidden="true"');
    expect(handle).toMatch(/class="[^"]*\bh-1\b/);
    expect(handle).toMatch(/class="[^"]*\bw-10\b/);
    expect(handle).toMatch(/class="[^"]*\bbg-input\b/);
    expect(handle).toMatch(/class="[^"]*\bhidden\b[^"]*\bphone:block\b/);
  });

  it('adds nothing a tablet sees: every phone class is a phone: variant, and the sheet keeps its own classes', () => {
    for (const name of [...PHONE_FRAME.split(' '), ...PHONE_SCRIM.split(' ')]) expect(name).toMatch(/^phone:/);
    const html = drawSheet();
    expect(dialogOf(html)).toContain('rounded-[28px]');
    expect(dialogOf(html)).toContain('max-w-[640px]');
    expect(dialogOf(html)).toContain('p-6');
    expect(scrimOf(html)).toContain('items-center');
    expect(scrimOf(html)).toContain('p-4');
  });

  it('has no sm: or md: class on a scrim or a frame that would compete with a phone class', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
    const { NativeEventSheet } = await import('../src/components/NativeEventSheet');
    const { MealSheet } = await import('../src/MealsPage');
    const sheets = [
      drawSheet(),
      renderToStaticMarkup(createElement(NativeEventSheet, { timezone: 'America/Chicago', profiles: [], date: '2026-10-02', onSaved: () => undefined, onClose: () => undefined })),
      renderToStaticMarkup(createElement(MealSheet, { editing: { date: '2026-10-02', slot: 'dinner', heading: 'Friday dinner', meal: null }, save: async () => undefined, onSaved: () => undefined, onClose: () => undefined })),
    ];
    for (const html of sheets) {
      for (const element of [scrimOf(html), dialogOf(html)]) {
        const own = classesOf(element);
        expect(own.some((name) => name.startsWith('phone:'))).toBe(true);
        expect(own.filter((name) => /^(sm|md):/.test(name))).toEqual([]);
      }
    }
  });

  it('is the same frame on the Add event sheet and on the meal sheet', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
    const { NativeEventSheet } = await import('../src/components/NativeEventSheet');
    const { MealSheet } = await import('../src/MealsPage');
    const native = renderToStaticMarkup(createElement(NativeEventSheet, { timezone: 'America/Chicago', profiles: [], date: '2026-10-02', onSaved: () => undefined, onClose: () => undefined }));
    const meal = renderToStaticMarkup(
      createElement(MealSheet, { editing: { date: '2026-10-02', slot: 'dinner', heading: 'Friday dinner', meal: null }, save: async () => undefined, onSaved: () => undefined, onClose: () => undefined }),
    );
    for (const html of [native, meal]) {
      expect(hasFrame(scrimOf(html), PHONE_SCRIM)).toBe(true);
      expect(hasFrame(dialogOf(html), PHONE_FRAME)).toBe(true);
      expect(handleOf(html)).toContain('aria-hidden="true"');
      expect(html.indexOf(handleOf(html))).toBeLessThan(html.indexOf('<h2'));
    }
    // The meal sheet's field and its message scroll between its title row and its buttons, on a phone.
    expect(meal.indexOf('phone:overflow-y-auto')).toBeGreaterThan(meal.indexOf('<h2'));
    expect(meal.indexOf('phone:overflow-y-auto')).toBeLessThan(meal.indexOf('Cancel'));
  });
});
