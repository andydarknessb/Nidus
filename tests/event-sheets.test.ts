import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventSheets as EventSheetsType } from '../src/components/EventSheets';
import type { Occurrence } from '../src/lib/calendar-occurrences';
import { createEventSheets, REFOCUS_MS, type OpenSheet } from '../src/lib/event-sheets';
import type { WallDay } from '../src/lib/paged-view';
import type { Pill } from '../src/lib/schedule';
import { createChange, type ChangeState } from '../src/lib/synced-read';
import { NOT_SAVED, NOT_SAVED_OFFLINE } from '../src/lib/write-failure';

// The event sheet host's core (spec 0012): what is open, what is remembered of the last sheet and for how long, and the one rule after
// a save. Plain TypeScript, so no screen is drawn; the hook (components/EventSheets.tsx) only gives these to React and puts focus
// where the core says. The form's words are the change's (synced-read.ts), tested here for the one place the form says them in.

const event = (id: string, more: Partial<Occurrence> = {}): Occurrence => ({
  source: 'native',
  id,
  calendar_id: null,
  calendar_name: 'Nidus',
  title: 'Piano',
  description: null,
  location: null,
  starts_at: '2026-10-01T21:00:00Z',
  ends_at: '2026-10-01T21:45:00Z',
  is_all_day: false,
  profile_id: null,
  profile_ids: [],
  event_id: null, repeat_every: null, repeat_interval: 1, repeat_days: null, repeat_until: null,
  ...more,
});
const PIANO = event('piano');
const SWIM = event('swim', { title: 'Swim' });
const DAY = { date: '2026-10-01' } as WallDay;
const PILLS = [{ occurrence: PIANO }, { occurrence: SWIM }] as unknown as Pill[];

function harness() {
  const refreshed: (OpenSheet | 'refresh')[] = [];
  const sheets = createEventSheets({ refresh: () => void refreshed.push('refresh') });
  const told: OpenSheet[] = [];
  sheets.subscribe(() => told.push(sheets.state()));
  return { sheets, refreshed, told };
}

describe('what is open', () => {
  it('is nothing until a screen opens something', () => {
    expect(createEventSheets().state()).toBeNull();
  });

  it("opens an event's details, from a pill, a block or a cluster's list", () => {
    const { sheets } = harness();
    sheets.open(PIANO);
    expect(sheets.state()).toEqual({ sheet: 'details', occurrence: PIANO });
  });

  it('goes from the details to Edit for the same event', () => {
    const { sheets } = harness();
    sheets.open(PIANO);
    sheets.edit();
    expect(sheets.state()).toEqual({ sheet: 'edit', occurrence: PIANO });
  });

  it('opens Edit for an event at once, with no details first (the Settings list)', () => {
    const { sheets, told } = harness();
    sheets.openEdit(PIANO);
    expect(sheets.state()).toEqual({ sheet: 'edit', occurrence: PIANO });
    expect(told).toEqual([{ sheet: 'edit', occurrence: PIANO }]);
  });

  it('does not go to Edit from anything but the details', () => {
    const { sheets } = harness();
    sheets.edit();
    expect(sheets.state()).toBeNull();
    sheets.add('2026-10-02');
    sheets.edit();
    expect(sheets.state()).toEqual({ sheet: 'add', date: '2026-10-02' });
  });

  it('opens the sheet that adds an event on the day it is given', () => {
    const { sheets } = harness();
    sheets.add('2026-10-02');
    expect(sheets.state()).toEqual({ sheet: 'add', date: '2026-10-02' });
  });

  it('waits when it is pressed before the screen knows its day, and opens on the day once it is known', () => {
    const { sheets, told } = harness();
    sheets.add(null);
    expect(sheets.state()).toEqual({ sheet: 'add', date: null });
    sheets.dayKnown('2026-10-03');
    expect(sheets.state()).toEqual({ sheet: 'add', date: '2026-10-03' });
    // A day learnt later never moves a sheet that has one, or opens one nobody asked for.
    sheets.dayKnown('2026-10-09');
    expect(sheets.state()).toEqual({ sheet: 'add', date: '2026-10-03' });
    sheets.close();
    sheets.dayKnown('2026-10-09');
    expect(sheets.state()).toBeNull();
    expect(told).toHaveLength(3);
  });

  it("opens the list of a cluster, and from it an event's details", () => {
    const { sheets } = harness();
    sheets.cluster(DAY, PILLS);
    expect(sheets.state()).toEqual({ sheet: 'cluster', day: DAY, pills: PILLS });
    sheets.open(SWIM);
    expect(sheets.state()).toEqual({ sheet: 'details', occurrence: SWIM });
  });

  it('closes, from any sheet', () => {
    const { sheets } = harness();
    for (const open of [() => sheets.open(PIANO), () => sheets.cluster(DAY, PILLS), () => sheets.add('2026-10-02')]) {
      open();
      sheets.close();
      expect(sheets.state()).toBeNull();
    }
    sheets.open(PIANO);
    sheets.edit();
    sheets.close();
    expect(sheets.state()).toBeNull();
  });

  it('tells its listeners of each change, until they stop listening, and of nothing when nothing changed', () => {
    const { sheets, told } = harness();
    sheets.close();
    expect(told).toEqual([]);
    sheets.open(PIANO);
    sheets.close();
    expect(told).toEqual([{ sheet: 'details', occurrence: PIANO }, null]);
    const stop = sheets.subscribe(() => told.push({ sheet: 'add', date: 'late' }));
    stop();
    sheets.add('2026-10-02');
    expect(told).toHaveLength(3);
  });
});

// The sheet that is open, drawn (static markup, as the sheets' own tests are): each state of the core is the one dialog it names, and a
// Household whose time zone is not read yet draws none.
describe('the sheets drawn', () => {
  let EventSheets: typeof EventSheetsType;
  beforeAll(async () => {
    // The sheets import the Supabase client, which is built on import and not used to draw: a placeholder URL and key are enough.
    vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
    ({ EventSheets } = await import('../src/components/EventSheets'));
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });
  const noop = () => undefined;
  const draw = (open: OpenSheet, timezone: string | null = 'America/Chicago') =>
    renderToStaticMarkup(createElement(EventSheets, { open, timezone, profiles: [], onOpen: noop, onEdit: noop, onClose: noop, onSaved: noop }));

  it("draws an event's details, Edit for a Native Event only", () => {
    const html = draw({ sheet: 'details', occurrence: PIANO });
    expect(html).toContain('aria-labelledby="event-details-title"');
    expect(html).toContain('Edit</button>');
    expect(draw({ sheet: 'details', occurrence: event('gcal', { source: 'synced', calendar_id: 'c1' }) })).not.toContain('Edit</button>');
  });

  it('draws the form that edits the event, and the form that adds one, each with its own title and button', () => {
    const edit = draw({ sheet: 'edit', occurrence: PIANO });
    expect(edit).toContain('Edit event');
    expect(edit).toContain('Save changes');
    const add = draw({ sheet: 'add', date: '2026-10-02' });
    expect(add).toContain('New event');
    expect(add).toContain('Add event');
    expect(add).not.toContain('Save changes');
  });

  it('draws the cluster list, and nothing when nothing is open or the time zone is not read', () => {
    expect(draw({ sheet: 'cluster', day: DAY, pills: [] })).toContain('aria-labelledby="cluster-list-title"');
    expect(draw(null)).toBe('');
    expect(draw({ sheet: 'add', date: '2026-10-02' }, null)).toBe('');
  });
});

describe('after a save', () => {
  it('closes the sheet and reads the screen again, in that order, for an edit, a delete and an added event alike', () => {
    const seen: (OpenSheet | 'refresh')[] = [];
    const sheets = createEventSheets({ refresh: () => seen.push(sheets.state() ?? 'refresh') });
    for (const open of [() => (sheets.open(PIANO), sheets.edit()), () => sheets.add('2026-10-02')]) {
      open();
      sheets.saved();
      expect(sheets.state()).toBeNull();
    }
    // Each time the sheet was already closed when the read was asked for.
    expect(seen).toEqual(['refresh', 'refresh']);
  });

  it('reads again only after a save, never after a close', () => {
    const { sheets, refreshed } = harness();
    sheets.open(PIANO);
    sheets.close();
    sheets.add('2026-10-02');
    sheets.close();
    expect(refreshed).toEqual([]);
    sheets.add('2026-10-02');
    sheets.saved();
    expect(refreshed).toEqual(['refresh']);
  });

  it('needs no read to be given (a screen with nothing to read again)', () => {
    const sheets = createEventSheets();
    sheets.add('2026-10-02');
    expect(() => sheets.saved()).not.toThrow();
    expect(sheets.state()).toBeNull();
  });
});

describe('where focus goes back to when a read took the opener away', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is nowhere before a sheet has been opened, and nowhere while one is open', () => {
    const { sheets } = harness();
    expect(sheets.refocus()).toBeNull();
    sheets.open(PIANO);
    expect(sheets.refocus()).toBeNull();
  });

  it('is the event the sheet was open for, once it has closed', () => {
    const { sheets } = harness();
    sheets.open(PIANO);
    sheets.close();
    expect(sheets.refocus()).toEqual({ id: 'piano' });
  });

  it('is the event the details were open for when Edit was saved or deleted, and also when the sheet was only closed', () => {
    const { sheets } = harness();
    sheets.open(PIANO);
    sheets.edit();
    sheets.saved();
    expect(sheets.refocus()).toEqual({ id: 'piano' });
    sheets.open(SWIM);
    sheets.close();
    expect(sheets.refocus()).toEqual({ id: 'swim' });
  });

  it('is the same for Edit opened at once as for Edit reached from the details', () => {
    const viaDetails = harness().sheets;
    viaDetails.open(PIANO);
    viaDetails.edit();
    viaDetails.saved();
    const direct = harness().sheets;
    direct.openEdit(PIANO);
    expect(direct.refocus()).toBeNull();
    direct.saved();
    expect(direct.refocus()).toEqual(viaDetails.refocus());
    expect(direct.refocus()).toEqual({ id: 'piano' });
    // The same ten seconds, from the close.
    vi.advanceTimersByTime(REFOCUS_MS + 1);
    expect(direct.refocus()).toBeNull();
    expect(viaDetails.refocus()).toBeNull();
  });

  it('is no event for a sheet that added one: what stands for its place', () => {
    const { sheets } = harness();
    sheets.add('2026-10-02');
    sheets.saved();
    expect(sheets.refocus()).toEqual({ id: null });
  });

  it('is the event picked from a cluster, and the cluster alone remembers nothing', () => {
    const { sheets } = harness();
    sheets.cluster(DAY, PILLS);
    sheets.close();
    expect(sheets.refocus()).toBeNull();
    sheets.cluster(DAY, PILLS);
    sheets.open(SWIM);
    sheets.close();
    expect(sheets.refocus()).toEqual({ id: 'swim' });
  });

  it('holds for ten seconds from the close, and more than that forgets it for good', () => {
    const { sheets } = harness();
    sheets.open(PIANO);
    sheets.close();
    vi.advanceTimersByTime(REFOCUS_MS);
    expect(REFOCUS_MS).toBe(10_000);
    expect(sheets.refocus()).toEqual({ id: 'piano' });
    vi.advanceTimersByTime(1);
    expect(sheets.refocus()).toBeNull();
    // Gone, not just late: nothing brings it back.
    vi.setSystemTime(Date.now() - 5_000);
    expect(sheets.refocus()).toBeNull();
  });

  it('counts from the close, not from the open: a sheet open for a minute still has its ten seconds', () => {
    const { sheets } = harness();
    sheets.open(PIANO);
    vi.advanceTimersByTime(60_000);
    expect(sheets.refocus()).toBeNull();
    sheets.close();
    vi.advanceTimersByTime(9_000);
    expect(sheets.refocus()).toEqual({ id: 'piano' });
  });

  it('is asked more than once in its window, as each read that lands in it asks', () => {
    const { sheets } = harness();
    sheets.open(PIANO);
    sheets.close();
    vi.advanceTimersByTime(2_000);
    expect(sheets.refocus()).toEqual({ id: 'piano' });
    vi.advanceTimersByTime(2_000);
    expect(sheets.refocus()).toEqual({ id: 'piano' });
  });

  it('starts over when another sheet is opened and closed, and is the clock the core is given when it is given one', () => {
    let clock = 1_000;
    const sheets = createEventSheets({ now: () => clock });
    sheets.open(PIANO);
    sheets.close();
    clock += 9_000;
    sheets.open(SWIM);
    sheets.close();
    clock += 9_000;
    expect(sheets.refocus()).toEqual({ id: 'swim' });
    clock += 2_000;
    expect(sheets.refocus()).toBeNull();
  });
});

// The form's own failure words went when it took the change's (spec 0012): one place, 'event', in its footer, where a write that did not
// go through is said, a field it is refused for is said, and an edit takes both away. Tested on the change itself, which the form
// calls as card.change('event', ...), card.say('event', ...) and card.clear('event').
describe("the event form's words", () => {
  const PLACE = 'event';
  const server500 = Object.assign(new Error('boom'), { code: '500' });
  const said = (c: { state(): ChangeState }) => c.state().problems[PLACE];

  it('says a write that did not go through in the one place, in the Wall\'s two sentences', async () => {
    const c = createChange();
    expect(await c.change(PLACE, () => Promise.reject(server500))).toBe('failed');
    expect(said(c)?.words).toBe(NOT_SAVED);
    const offline = createChange({ offline: () => true });
    await offline.change(PLACE, () => Promise.reject(Object.assign(new Error('x'), { code: '' })));
    expect(said(offline)?.words).toBe(NOT_SAVED_OFFLINE);
    // A request that never got an answer says so whatever the screen thought.
    const lost = createChange();
    await lost.change(PLACE, () => Promise.reject(new TypeError('Failed to fetch')));
    expect(said(lost)?.words).toBe(NOT_SAVED_OFFLINE);
  });

  it('says a repeat of the same failure again: the count goes up though the words are the same, which the form keys its alert on', async () => {
    const c = createChange();
    await c.change(PLACE, () => Promise.reject(server500));
    const first = said(c)!;
    await c.change(PLACE, () => Promise.reject(server500));
    const second = said(c)!;
    expect(second.words).toBe(first.words);
    expect(second.n).toBeGreaterThan(first.n);
  });

  it('keeps the words while a retry is on its way, so the footer does not move under the finger that pressed Save', async () => {
    const c = createChange();
    await c.change(PLACE, () => Promise.reject(server500));
    const retry = c.change(PLACE, () => new Promise<void>(() => undefined));
    expect(c.state().busy).toBe(true);
    expect(said(c)?.words).toBe(NOT_SAVED);
    void retry;
  });

  it('takes the words away on an edit, and when the write lands', async () => {
    const c = createChange();
    await c.change(PLACE, () => Promise.reject(server500));
    c.clear(PLACE);
    expect(said(c)).toBeUndefined();
    await c.change(PLACE, () => Promise.reject(server500));
    expect(said(c)).toBeDefined();
    await c.change(PLACE, async () => undefined);
    expect(said(c)).toBeUndefined();
  });

  it('says what a field is refused for in the same place, and an edit takes that away too', () => {
    const c = createChange();
    c.say(PLACE, 'Give the event a title.');
    expect(said(c)).toMatchObject({ words: 'Give the event a title.', refused: false });
    c.say(PLACE, 'Give the event a title.');
    expect(said(c)!.n).toBe(2);
    c.clear(PLACE);
    expect(said(c)).toBeUndefined();
  });

  it('lets a failure replace what a field was refused for, and the other way round', async () => {
    const c = createChange();
    c.say(PLACE, 'Pick a date.');
    await c.change(PLACE, () => Promise.reject(server500));
    expect(said(c)?.words).toBe(NOT_SAVED);
    c.say(PLACE, 'Pick a date.');
    expect(said(c)?.words).toBe('Pick a date.');
  });

  it('does nothing while a write is on its way, so a second press of Save is no second event', async () => {
    const c = createChange();
    let release!: () => void;
    const writes: string[] = [];
    const first = c.change(PLACE, () => new Promise<void>((resolve) => ((release = resolve), writes.push('first'))));
    expect(await c.change(PLACE, async () => void writes.push('second'))).toBe('busy');
    release();
    await first;
    expect(writes).toEqual(['first']);
  });

  it('lets the sheet close on landing while the guard is still held, and frees it once it has', async () => {
    const c = createChange();
    const seen: boolean[] = [];
    await c.change(PLACE, async () => undefined, { landed: () => void seen.push(c.state().busy) });
    expect(seen).toEqual([true]);
    expect(c.state().busy).toBe(false);
  });
});
