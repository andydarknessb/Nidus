import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { EventQuestion as EventQuestionType, NativeEventSheet as NativeEventSheetType } from '../src/components/NativeEventSheet';
import type { Occurrence } from '../src/lib/calendar-occurrences';
import { timeInputWords } from '../src/lib/native-events';

// The Add event sheet drawn to markup (spec 0003, Add event sheet; spec 0013, the Repeats row). The form's rules are the event draft's
// (tests/event-draft.test.ts) and what is written is the plan runner's (tests/native-events.test.ts). Every date goes through the
// Household Timezone, never the machine's.

const CHICAGO = 'America/Chicago';

describe('Starts and Ends', () => {
  // (The rules for setting a time are in event-draft.test.ts.) The sheet opened by a tap cannot be drawn to markup; what is drawn is
  // the two buttons that open it.
  let NativeEventSheet: typeof NativeEventSheetType;
  beforeAll(async () => {
    // It imports the Supabase client, which is built on import and not used to draw: a placeholder URL and key are enough.
    vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
    ({ NativeEventSheet } = await import('../src/components/NativeEventSheet'));
  });
  const props = { timezone: CHICAGO, profiles: [], onSaved: () => undefined, onClose: () => undefined };
  const drawNew = () => renderToStaticMarkup(createElement(NativeEventSheet, { ...props, date: '2026-10-02' }));
  const drawEdit = (changes: Partial<Occurrence> = {}) =>
    renderToStaticMarkup(
      createElement(NativeEventSheet, {
        ...props,
        occurrence: { title: 'Plumber', description: null, location: null, starts_at: '2026-10-02T19:10:00Z', ends_at: '2026-10-02T20:20:00Z', is_all_day: false, profile_ids: [], ...changes } as unknown as Occurrence,
      }),
    );
  const buttonNamed = (html: string, label: string) => /<button[^>]*>/.exec(html.slice(html.indexOf(`aria-label="${label}"`) - 80))?.[0] ?? '';

  it('are two buttons, each named for its time: "Starts, 9:00 AM" and "Ends, 10:00 AM"', () => {
    const html = drawNew();
    for (const label of ['Starts, 9:00 AM', 'Ends, 10:00 AM']) {
      expect(html).toContain(`aria-label="${label}"`);
      const button = buttonNamed(html, label);
      expect(button).toContain('type="button"');
      expect(button).toMatch(/class="[^"]*\bh-15\b/);
      expect(button).toMatch(/class="[^"]*\bw-full\b/);
      expect(button).toMatch(/class="[^"]*\brounded-2xl\b[^"]*\bbg-muted\b[^"]*\bpx-4\b/);
    }
    // Their captions are over them, and the buttons are named for the whole.
    expect(html).toContain('>Starts</span>');
    expect(html).toContain('>Ends</span>');
  });

  it('show the time as the steppers did: the clock in Young Serif at 24, the AM or PM small', () => {
    const html = drawEdit();
    expect(html).toContain('aria-label="Starts, 2:10 PM"');
    expect(html).toContain('aria-label="Ends, 3:20 PM"');
    expect(html).toContain('<span class="font-display text-2xl">2:10</span><span class="text-base font-medium">PM</span>');
    expect(html).toContain('<span class="font-display text-2xl">3:20</span><span class="text-base font-medium">PM</span>');
  });

  it('have no stepper left: no minus, no plus, no live region', () => {
    for (const html of [drawNew(), drawEdit()]) {
      expect(html).not.toMatch(/aria-label="(?:Start|End) (?:earlier|later)"/);
      expect(html).not.toContain('<output');
      expect(html).not.toContain('lucide-minus');
      expect(html).not.toContain('lucide-plus');
    }
  });

  it('draw no time sheet until one is tapped', () => {
    const html = drawNew();
    expect(html.match(/role="dialog"/g)).toHaveLength(1);
    expect(html).not.toContain('Type a time like 4:30 PM');
  });

  it('are hidden by All day, and keep their room on the Wall', () => {
    const html = drawEdit({ is_all_day: true });
    expect(html).toContain('hidden min-[960px]:invisible min-[960px]:grid');
    expect(drawNew()).not.toContain('min-[960px]:invisible');
  });

  it('says its times as the family reads them', () => {
    expect(timeInputWords('00:00')).toBe('12:00 AM');
    expect(timeInputWords('09:05')).toBe('9:05 AM');
    expect(timeInputWords('12:00')).toBe('12:00 PM');
    expect(timeInputWords('14:00')).toBe('2:00 PM');
    expect(timeInputWords('23:45')).toBe('11:45 PM');
  });
});

// The Repeats row (spec 0013, "The Repeats control and the words"): its pills, the number, the weekday chips and the end, drawn
// from the form; and the footer's question for an Occurrence of a Repeat.
describe('the Repeats row', () => {
  let NativeEventSheet: typeof NativeEventSheetType;
  let EventQuestion: typeof EventQuestionType;
  beforeAll(async () => {
    vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
    ({ NativeEventSheet, EventQuestion } = await import('../src/components/NativeEventSheet'));
  });
  const props = { timezone: CHICAGO, profiles: [], onSaved: () => undefined, onClose: () => undefined };
  const drawNew = () => renderToStaticMarkup(createElement(NativeEventSheet, { ...props, date: '2026-10-06' }));
  // An Occurrence of a Repeat, Tuesday Oct 6 at 3:00 PM in Chicago; `changes` is its Repeat.
  const drawEdit = (changes: Partial<Occurrence> = {}) =>
    renderToStaticMarkup(
      createElement(NativeEventSheet, {
        ...props,
        occurrence: { title: 'Soccer', description: null, location: null, starts_at: '2026-10-06T20:00:00Z', ends_at: '2026-10-06T21:00:00Z', is_all_day: false, profile_ids: [], repeat_every: null, repeat_interval: 1, repeat_days: null, repeat_until: null, ...changes } as unknown as Occurrence,
      }),
    );
  const weekly = { repeat_every: 'week', repeat_interval: 2, repeat_days: 4 } as const;
  const text = (markup: string) => markup.replace(/<[^>]*>/g, '').replace(/&#x27;/g, "'");
  // Every button of the markup: its attributes and its words.
  const buttons = (html: string) => [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/gs)].map((match) => ({ attrs: match[1]!, words: text(match[2]!) }));
  const button = (html: string, words: string) => buttons(html).find((found) => found.words === words);
  const pressed = (html: string, words: string) => /aria-pressed="true"/.test(button(html, words)?.attrs ?? '');
  const PILLS = ["Doesn't repeat", 'Every day', 'Every week', 'Every month', 'Every year'];

  it('has a caption and five pills under All day, 52 tall, the first pressed for a new event', () => {
    const html = drawNew();
    expect(html.indexOf('All day')).toBeLessThan(html.indexOf('>Repeats</span>'));
    expect(html.indexOf('>Repeats</span>')).toBeLessThan(html.indexOf('Who is it for?'));
    for (const pill of PILLS) {
      expect(button(html, pill), pill).toBeDefined();
      expect(button(html, pill)!.attrs).toMatch(/class="[^"]*\bh-13\b[^"]*\brounded-full\b/);
      expect(pressed(html, pill), pill).toBe(pill === "Doesn't repeat");
    }
    // In their order, one row of the same pills.
    expect(buttons(html).map((found) => found.words).filter((words) => PILLS.includes(words))).toEqual(PILLS);
  });

  it('shows nothing under the pills while the event does not repeat', () => {
    const html = drawNew();
    expect(html).not.toContain('Every how many');
    expect(html).not.toContain('Repeat until');
    expect(buttons(html).some((found) => found.words === 'Never' || found.words === 'On a date')).toBe(false);
    expect(buttons(html).some((found) => /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)$/.test(found.words))).toBe(false);
    expect(drawEdit()).not.toContain('Every how many');
  });

  it('presses the shape of the Repeat an Occurrence has, with its number, its days and its end', () => {
    const html = drawEdit(weekly);
    expect(PILLS.filter((pill) => pressed(html, pill))).toEqual(['Every week']);
    // A numeric field of 1 to 99, 60 tall and 80 wide, then the unit's plural.
    const field = /<input[^>]*aria-label="Every how many"[^>]*>/.exec(html)![0];
    expect(field).toContain('type="number"');
    expect(field).toContain('inputMode="numeric"');
    expect(field).toContain('min="1"');
    expect(field).toContain('max="99"');
    expect(field).toContain('value="2"');
    expect(field).toMatch(/class="[^"]*\bh-15\b[^"]*\bw-20\b/);
    expect(text(html)).toMatch(/Every\s*weeks/);
    // Seven chips, Sunday first, the Occurrence's weekday pressed and no other.
    const chips = buttons(html).filter((found) => /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)$/.test(found.words));
    expect(chips.map((chip) => chip.words)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    expect(chips.map((chip) => /aria-label="(\w+)"/.exec(chip.attrs)![1])).toEqual(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
    expect(chips.filter((chip) => /aria-pressed="true"/.test(chip.attrs)).map((chip) => chip.words)).toEqual(['Tue']);
    for (const chip of chips) expect(chip.attrs).toMatch(/class="[^"]*\bh-13\b/);
    // It never ends, so the date field is not drawn.
    expect(pressed(html, 'Never')).toBe(true);
    expect(pressed(html, 'On a date')).toBe(false);
    expect(html).not.toContain('Repeat until');
  });

  it('shows the date a Repeat ends on in a date field', () => {
    const html = drawEdit({ ...weekly, repeat_until: '2026-12-20' });
    expect(pressed(html, 'On a date')).toBe(true);
    expect(pressed(html, 'Never')).toBe(false);
    const field = /<input[^>]*aria-label="Repeat until"[^>]*>/.exec(html)![0];
    expect(field).toContain('type="date"');
    expect(field).toContain('value="2026-12-20"');
    expect(html).toContain('>Ends</span>');
  });

  it('counts a day, a month and a year in their plural, and has weekday chips only for a week', () => {
    for (const [every, plural] of [['day', 'days'], ['month', 'months'], ['year', 'years']] as const) {
      const html = drawEdit({ repeat_every: every, repeat_interval: 1, repeat_days: null });
      expect(text(html), every).toMatch(new RegExp(`Every\\s*${plural}`));
      expect(buttons(html).some((found) => found.words === 'Tue')).toBe(false);
      expect(pressed(html, `Every ${every}`)).toBe(true);
    }
  });

  it('asks nothing on opening, for an event that repeats or not', () => {
    for (const html of [drawEdit(weekly), drawEdit()]) {
      expect(html).not.toContain('Change this one, or every one?');
      expect(html).not.toContain('Delete this one, or every one?');
      expect(button(html, 'Save changes')).toBeDefined();
      expect(button(html, 'Delete')).toBeDefined();
    }
  });

  const ask = (asking: 'delete' | 'save', repeating: boolean) =>
    renderToStaticMarkup(createElement(EventQuestion, { asking, title: 'Soccer', repeating, busy: false, onBack: () => undefined, onOne: () => undefined, onEvery: () => undefined }));

  it('asks "Change this one, or every one?" at Save and "Delete this one, or every one?" at Delete, for a Repeat', () => {
    const save = ask('save', true);
    expect(text(save)).toContain('Change this one, or every one?');
    expect(buttons(save).map((found) => found.words)).toEqual(['Back', 'This one', 'Every one']);
    const del = ask('delete', true);
    expect(text(del)).toContain('Delete this one, or every one?');
    expect(buttons(del).map((found) => found.words)).toEqual(['Back', 'This one', 'Every one']);
    for (const html of [save, del]) {
      // Focus lands on the safe answer, and the question is its description.
      expect(button(html, 'This one')!.attrs).toContain('aria-describedby="ask-question"');
      expect(button(html, 'This one')!.attrs).toContain('autofocus');
      expect(button(html, 'Every one')!.attrs).not.toContain('autofocus');
      expect(html).toContain('id="ask-question"');
      expect(text(html)).not.toMatch(/[–—]/);
    }
    // Every one is the danger at Delete, and the main answer at Save.
    expect(button(del, 'Every one')!.attrs).not.toBe(button(save, 'Every one')!.attrs);
  });

  // On a tablet upright (800 wide) the three answers left the question 192 px, and it was cut to "Change this one, or ev…". It is never
  // cut: it is as wide as its words (flex-auto), and wraps to its own row when the answers leave it less.
  it('reads the question about a Repeat whole, and lets only a title give way', () => {
    const question = (html: string) => /<p id="ask-question" class="([^"]*)"/.exec(html)?.[1]?.split(' ') ?? [];
    for (const asking of ['save', 'delete'] as const) {
      expect(question(ask(asking, true))).not.toContain('truncate');
      expect(question(ask(asking, true))).toContain('flex-auto');
    }
    expect(question(ask('delete', false))).toContain('truncate');
  });

  it('asks "Delete <title>?" and nothing about "this one" for an event that does not repeat', () => {
    const html = ask('delete', false);
    expect(text(html)).toContain('Delete Soccer?');
    expect(text(html)).not.toContain('this one');
    expect(buttons(html).map((found) => found.words)).toEqual(['Keep it', 'Delete']);
    expect(button(html, 'Keep it')!.attrs).toContain('autofocus');
  });
});
