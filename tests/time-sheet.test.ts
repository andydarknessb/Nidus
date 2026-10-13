import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TimeSheet } from '../src/components/TimeSheet';
import { elementAt } from './support/markup';

// The time sheet as it is first drawn (docs/specs/0013, The time sheet; docs/look.md, A sheet and A field). Rendered to markup, so what is
// asserted is what the browser is given: that a roll rewrites the field and a typed time rolls the drums, that Escape stays in the sheet
// and that focus returns to the button that opened it are looked at in the browser, and the rules they use are in time-picker.test.ts.

const draw = (which: 'start' | 'end' = 'start', time = '14:00') =>
  renderToStaticMarkup(createElement(TimeSheet, { which, time, onDone: () => undefined, onClose: () => undefined }));
const tag = (html: string, pattern: RegExp) => pattern.exec(html)?.[0] ?? '';
// The drums: the aria-hidden boxes that snap, whole.
const drums = (html: string) => [...html.matchAll(/<div[^>]*aria-hidden="true"[^>]*snap-mandatory[^>]*>/g)].map((found) => elementAt(html, found.index));
const rows = (drum: string) => [...drum.matchAll(/<div class="flex h-12 [^"]*">([^<]*)<\/div>/g)].map((found) => found[0]);
const chosen = (drum: string) => rows(drum).filter((row) => row.includes('font-semibold'));
const button = (html: string, label: string) => tag(html, new RegExp(`<button[^>]*>${label}</button>`));

describe('the time sheet', () => {
  it('is a dialog titled Starts or Ends, at most 420 wide, that is a form so that Enter is Done', () => {
    for (const [which, title] of [['start', 'Starts'], ['end', 'Ends']] as const) {
      const html = draw(which);
      const dialog = tag(html, /<form[^>]*role="dialog"[^>]*>/);
      expect(dialog).toContain('aria-modal="true"');
      expect(dialog).toContain('max-w-[420px]');
      const labelledBy = /aria-labelledby="([^"]*)"/.exec(dialog)?.[1];
      expect(labelledBy).toBeTruthy();
      expect(tag(html, /<h2[^>]*>[^<]*<\/h2>/)).toContain(`id="${labelledBy}"`);
      expect(tag(html, /<h2[^>]*>[^<]*<\/h2>/)).toContain(`>${title}<`);
    }
  });

  it('has a text field labelled Time, 60 tall at 17 px, with its hint', () => {
    const html = draw();
    const input = tag(html, /<input[^>]*>/);
    expect(input).toContain('type="text"');
    expect(input).toContain('inputMode="text"');
    expect(input).toContain('autoComplete="off"');
    expect(input).toMatch(/class="[^"]*\bh-15\b/);
    expect(input).toMatch(/class="[^"]*\btext-\[17px\]/);
    expect(input).toContain('value="2:00 PM"');
    const label = elementAt(html, html.indexOf('<label'));
    expect(label).toContain('>Time<');
    expect(label).toContain(input);
    const hint = /aria-describedby="([^"]*)"/.exec(input)?.[1];
    expect(hint).toBeTruthy();
    expect(html).toContain(`<p id="${hint}" class="text-[15px] leading-5 text-muted-foreground">Type a time like 4:30 PM</p>`);
  });

  it('shows the time it is given in the field, as the form says it', () => {
    expect(tag(draw('start', '09:05'), /<input[^>]*>/)).toContain('value="9:05 AM"');
    expect(tag(draw('end', '00:00'), /<input[^>]*>/)).toContain('value="12:00 AM"');
    expect(tag(draw('end', '23:45'), /<input[^>]*>/)).toContain('value="11:45 PM"');
  });

  it('draws three drums, hidden from a screen reader and out of the tab order, that scroll-snap in 48 px rows', () => {
    const html = draw();
    const all = drums(html);
    expect(all).toHaveLength(3);
    for (const drum of all) {
      const box = tag(drum, /^<div[^>]*>/);
      expect(box).toContain('aria-hidden="true"');
      expect(box).toContain('tabindex="-1"');
      expect(box).toMatch(/class="[^"]*\bsnap-y\b/);
      expect(box).toMatch(/class="[^"]*\bsnap-mandatory\b/);
      expect(box).toMatch(/class="[^"]*\boverflow-y-auto\b/);
      // Five rows tall, with its scrollbar not drawn.
      expect(box).toMatch(/class="[^"]*\bh-60\b/);
      expect(box).toContain('scrollbar-width:none');
      for (const row of rows(drum)) {
        expect(row).toMatch(/class="[^"]*\bh-12\b[^"]*\bsnap-center\b/);
        expect(row).toContain('items-center justify-center');
      }
      // Two rows of room above the first and below the last, so the chosen one can sit in the middle.
      expect(drum.match(/<div class="h-24"><\/div>/g)).toHaveLength(2);
    }
  });

  it('has an hour, a minute in fives and an AM or PM on its drums', () => {
    const [hours, minutes, meridiems] = drums(draw()).map((drum) => rows(drum).map((row) => />([^<]*)</.exec(row)?.[1]));
    expect(hours).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']);
    expect(minutes).toEqual(['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55']);
    expect(meridiems).toEqual(['AM', 'PM']);
  });

  it('sets the chosen row apart: --foreground, 22 px and 600, and the rest in --muted-foreground', () => {
    const [hours, minutes, meridiems] = drums(draw('start', '16:37')) as [string, string, string];
    expect(chosen(hours)).toHaveLength(1);
    expect(chosen(hours)[0]).toContain('>4<');
    expect(chosen(hours)[0]).toMatch(/text-\[22px\]/);
    expect(chosen(hours)[0]).toMatch(/\btext-foreground\b/);
    // 4:37 is on the 4:35 row, the nearest at or below.
    expect(chosen(minutes)[0]).toContain('>35<');
    expect(chosen(meridiems)[0]).toContain('>PM<');
    for (const drum of [hours, minutes, meridiems]) {
      const rest = rows(drum).filter((row) => !row.includes('font-semibold'));
      expect(rest.length).toBeGreaterThan(0);
      for (const row of rest) expect(row).toContain('text-muted-foreground');
    }
  });

  it('has Cancel and Done at 56 tall, Done the one primary button and the one that submits', () => {
    const html = draw();
    const done = button(html, 'Done');
    const cancel = button(html, 'Cancel');
    expect(done).toContain('type="submit"');
    expect(done).toMatch(/class="[^"]*\bh-14\b/);
    expect(done).toContain('bg-primary');
    expect(cancel).toContain('type="button"');
    expect(cancel).toMatch(/class="[^"]*\bh-14\b/);
    expect(cancel).not.toContain('bg-primary');
    // A Close at the top right, as every sheet has, and nothing else that submits.
    expect(html.match(/type="submit"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Close"');
  });

  it('says no problem until there is one', () => {
    expect(draw()).not.toContain('role="alert"');
  });

  it('is drawn in the one frame, with the phone’s from the Sheet and no width query of its own', () => {
    const html = draw();
    expect(tag(html, /<form[^>]*role="dialog"[^>]*>/)).toContain('phone:rounded-t-3xl');
    const source = readFileSync(new URL('../src/components/TimeSheet.tsx', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
    expect(source).not.toMatch(/\b(?:sm|md|lg|xl|phone):|min-\[|max-\[|matchMedia|@media/);
  });

  it('colours nothing by mode', () => {
    const source = readFileSync(new URL('../src/components/TimeSheet.tsx', import.meta.url), 'utf8');
    expect(source).not.toMatch(/dark:|data-mode|#[0-9a-f]{3,6}\b/i);
  });

  it('uses no dash of any length in what it says', () => {
    expect(draw().replace(/<[^>]*>/g, ' ')).not.toMatch(/[–—]/);
  });
});

describe('the time sheet over the form', () => {
  const source = (file: string) => readFileSync(new URL('../src/' + file, import.meta.url), 'utf8');

  it('is drawn beside the form’s sheet and not inside it, so that its Escape never reaches the form’s dialog through the tree', () => {
    const form = source('components/NativeEventSheet.tsx');
    expect(form.indexOf('<TimeSheet')).toBeGreaterThan(form.indexOf('</Sheet>'));
  });

  it('closes on the Sheet’s own keys and scrim, and opens the field', () => {
    const sheet = source('components/TimeSheet.tsx');
    expect(sheet).toContain('initialFocus={field}');
    expect(sheet).toContain('onSubmit={submit}');
    expect(sheet).toContain('onClose={onClose}');
    // No canDismiss: the scrim always closes it, and nothing typed is kept.
    expect(sheet).not.toContain('canDismiss');
  });
});
