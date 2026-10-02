import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Button } from '../src/components/ui/button';
import {
  ALIASES,
  DARK_MIX,
  FAMILIES,
  TOKENS,
  familyOf,
  mix,
  personRoles,
  personStyle,
  type Mode,
  type Steps,
  type TokenName,
} from '../src/lib/look';
import { PROFILE_PALETTE, contrastRatio } from '../src/lib/profiles';

const MODES: Mode[] = ['light', 'dark'];

// ---- The look as data: every pair at its floor ---------------------------------------------------

// docs/look.md: words on their ground are 7:1 or better, and a shape that carries meaning (a ring, an outline, a
// picture, a progress pip) is 3:1 or better.
const WORDS = 7;
const SHAPE = 3;

type Pair = { what: string; foreground: string; ground: string; floor: number };

// Every pair the look draws in one mode, for one person's four steps: the person's own roles, and the chrome on them.
function pairsOf(mode: Mode, family: Steps & { name: string }): Pair[] {
  const t = TOKENS[mode];
  const p = personRoles(mode, family);
  return [
    { what: `${family.name}: words on a fill`, foreground: t.foreground, ground: p.fill, floor: WORDS },
    { what: `${family.name}: words on a soft`, foreground: t.foreground, ground: p.soft, floor: WORDS },
    { what: `${family.name}: secondary words on a soft`, foreground: t['muted-foreground'], ground: p.soft, floor: WORDS },
    { what: `${family.name}: ink on a finished tile`, foreground: p.onBase, ground: p.base, floor: WORDS },
    { what: `${family.name}: the initial on its disc`, foreground: p.onStrong, ground: p.strong, floor: WORDS },
    { what: `${family.name}: strong on a fill`, foreground: p.strong, ground: p.fill, floor: SHAPE },
    { what: `${family.name}: strong on a soft`, foreground: p.strong, ground: p.soft, floor: SHAPE },
    { what: `${family.name}: strong on a card`, foreground: p.strong, ground: t.card, floor: SHAPE },
    { what: `${family.name}: strong on a tile`, foreground: p.strong, ground: t.muted, floor: SHAPE },
    { what: `${family.name}: an empty pip on a soft`, foreground: t.input, ground: p.soft, floor: SHAPE },
    { what: `${family.name}: the tick on its disc`, foreground: p.onTick, ground: p.tick, floor: SHAPE },
    { what: `${family.name}: the tick disc on a finished tile`, foreground: p.tick, ground: p.base, floor: SHAPE },
    { what: `${family.name}: the picture on its done disc`, foreground: p.donePicture, ground: p.doneDisc, floor: SHAPE },
  ];
}

function chromePairs(mode: Mode): Pair[] {
  const t = TOKENS[mode];
  const grounds = ['background', 'card', 'muted', 'accent', 'everyone'] as const;
  return [
    ...grounds.flatMap((ground) => [
      { what: `words on ${ground}`, foreground: t.foreground, ground: t[ground], floor: WORDS },
      { what: `secondary words on ${ground}`, foreground: t['muted-foreground'], ground: t[ground], floor: WORDS },
    ]),
    { what: 'words on the primary action', foreground: t['primary-foreground'], ground: t.primary, floor: WORDS },
    { what: 'words on delete', foreground: t['destructive-foreground'], ground: t.destructive, floor: WORDS },
    ...(['background', 'card', 'muted', 'accent'] as const).map((ground) => ({ what: `the focus ring on ${ground}`, foreground: t.ring, ground: t[ground], floor: SHAPE })),
    ...(['card', 'muted'] as const).flatMap((ground) => [
      { what: `an outline or empty ring on ${ground}`, foreground: t.input, ground: t[ground], floor: SHAPE },
      { what: `today's disc on ${ground}`, foreground: t.primary, ground: t[ground], floor: SHAPE },
    ]),
    { what: 'the house disc on everyone', foreground: t.primary, ground: t.everyone, floor: SHAPE },
  ];
}

describe('the look as data', () => {
  it('holds every pair of words at 7:1 and every shape at 3:1, for all ten families in both modes', () => {
    for (const mode of MODES) {
      for (const pair of [...chromePairs(mode), ...FAMILIES.flatMap((family) => pairsOf(mode, family))]) {
        expect(contrastRatio(pair.foreground, pair.ground), `${mode}: ${pair.what}`).toBeGreaterThanOrEqual(pair.floor);
      }
    }
  });

  it("holds a person's disc to 3:1 on everyone else's fill, since a shared event is striped in each person's colour", () => {
    for (const mode of MODES) {
      for (const person of FAMILIES) {
        for (const other of FAMILIES) {
          const ratio = contrastRatio(personRoles(mode, person).strong, personRoles(mode, other).fill);
          expect(ratio, `${mode}: ${person.name} on ${other.name}`).toBeGreaterThanOrEqual(SHAPE);
        }
      }
    }
  });

  it('has the ten families the Profiles store, each stored as its 300 step', () => {
    expect(FAMILIES.map((family) => family.name)).toEqual(PROFILE_PALETTE.map((color) => color.name));
    expect(FAMILIES.map((family) => family[300])).toEqual(PROFILE_PALETTE.map((color) => color.hex.toUpperCase()));
    for (const family of FAMILIES) {
      for (const step of [100, 200, 300, 800] as const) expect(family[step], `${family.name} ${step}`).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('mixes the dark soft and fill into the card at the exported percentages', () => {
    const blue = FAMILIES.find((family) => family.name === 'Blue')!;
    expect(personRoles('dark', blue).soft).toBe(mix(blue[300], DARK_MIX.soft, TOKENS.dark.card));
    expect(personRoles('dark', blue).fill).toBe(mix(blue[300], DARK_MIX.fill, TOKENS.dark.card));
    expect(mix('#FFFFFF', 25, '#000000')).toBe('#404040');
    expect(mix('#FF0000', 100, '#0000FF')).toBe('#FF0000');
  });
});

describe('a Profile colour', () => {
  it('is its own family when it is in the palette, in any case', () => {
    for (const color of PROFILE_PALETTE) {
      expect(familyOf(color.hex).name).toBe(color.name);
      expect(familyOf(color.hex.toUpperCase()).name).toBe(color.name);
    }
  });

  it('takes the nearest family when it is not in the palette', () => {
    expect(familyOf('#fca5a6').name).toBe('Red');
    expect(familyOf('#92c5fb').name).toBe('Blue');
  });

  it("is drawn from the four steps of its family, as custom properties", () => {
    expect(personStyle('#93c5fd')).toEqual({ '--person-100': '#DBEAFE', '--person-200': '#BFDBFE', '--person-300': '#93C5FD', '--person-800': '#1E40AF' });
  });
});

// ---- src/index.css: the same values, read the way a browser reads them ----------------------------

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// How many top-level blocks in the file have exactly this selector (at the start of a line, then ` {`).
const blockCount = (selector: string) => [...css.matchAll(new RegExp(`^${escapeRegExp(selector)} \\{`, 'gm'))].length;

// How many times a custom property is declared anywhere in the file, in any block, inside any @media or @layer.
const declaredCount = (name: string) => [...css.matchAll(new RegExp(`(?<![\\w-])${escapeRegExp(name)}\\s*:`, 'g'))].length;

// The declarations of the one top-level block whose selector is exactly `selector`. It throws unless there is exactly one:
// a second block would otherwise go unread, and its values would be what the browser draws.
function declarations(selector: string): Map<string, string> {
  const found = blockCount(selector);
  if (found !== 1) throw new Error(`src/index.css has ${found} "${selector}" blocks, and the look wants exactly one`);
  const open = new RegExp(`^${escapeRegExp(selector)} \\{`, 'm').exec(css)!;
  const start = open.index + open[0].length;
  const body = css.slice(start, css.indexOf('}', start));
  return new Map([...body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1]!, match[2]!.trim()]));
}

// What a declared value comes to in a scope of custom properties: a colour as #RRGGBB, or any other value as its
// words in lower case with single spaces. Understands the three forms index.css uses: a literal, var() and a
// color-mix() in sRGB.
function evaluate(value: string, scope: ReadonlyMap<string, string>): string {
  const v = value.trim();
  const variable = /^var\((--[\w-]+)\)$/.exec(v);
  if (variable) {
    const found = scope.get(variable[1]!);
    if (found === undefined) throw new Error(`${variable[1]} is not defined`);
    return evaluate(found, scope);
  }
  const mixed = /^color-mix\(in srgb, (.+?) (\d+)%, (.+)\)$/.exec(v);
  if (mixed) return mix(evaluate(mixed[1]!, scope), Number(mixed[2]), evaluate(mixed[3]!, scope));
  return /^#[0-9a-f]{6}$/i.test(v) ? v.toUpperCase() : v.replace(/\s+/g, ' ').toLowerCase();
}

// The custom properties in force for a mode: the root's, and for dark the dark block laid over them.
function scopeOf(mode: Mode): Map<string, string> {
  const scope = declarations(':root');
  if (mode === 'dark') for (const [name, value] of declarations(":root[data-mode='dark']")) scope.set(name, value);
  return scope;
}

// The custom properties in force on an element with the class `person` and no style of its own: the mode's, with the `.person`
// rules over them. A style from personStyle() sets the four steps on top of these.
function personScope(mode: Mode): Map<string, string> {
  const scope = scopeOf(mode);
  for (const [name, value] of declarations('.person')) scope.set(name, value);
  if (mode === 'dark') for (const [name, value] of declarations(":root[data-mode='dark'] .person")) scope.set(name, value);
  return scope;
}

const kebab = (role: string) => role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

describe('src/index.css', () => {
  it('defines every token of docs/look.md for both modes, equal to look.ts', () => {
    for (const mode of MODES) {
      const scope = scopeOf(mode);
      for (const [name, value] of Object.entries(TOKENS[mode])) {
        expect(evaluate(`var(--${name})`, scope), `${mode}: --${name}`).toBe(evaluate(value, new Map()));
      }
    }
  });

  it('defines the dark block with every token, so dark never leans on a light value', () => {
    const custom = [...declarations(":root[data-mode='dark']").keys()].filter((name) => name.startsWith('--'));
    expect(custom.sort()).toEqual(Object.keys(TOKENS.dark).map((name) => `--${name}`).sort());
  });

  it('defines the tokens that are another token, in both modes', () => {
    for (const mode of MODES) {
      const scope = scopeOf(mode);
      for (const [alias, target] of Object.entries(ALIASES)) {
        expect(evaluate(`var(--${alias})`, scope), `${mode}: --${alias}`).toBe(evaluate(TOKENS[mode][target as TokenName], new Map()));
      }
    }
  });

  it("derives a person's roles from the four steps to the colours look.ts holds, for all ten families in both modes", () => {
    for (const mode of MODES) {
      for (const family of FAMILIES) {
        const scope = personScope(mode);
        for (const step of [100, 200, 300, 800] as const) scope.set(`--person-${step}`, family[step]);
        for (const [role, expected] of Object.entries(personRoles(mode, family))) {
          expect(evaluate(`var(--person-${kebab(role)})`, scope), `${mode}: ${family.name} ${role}`).toBe(expected);
        }
      }
    }
  });

  // A custom property that nothing sets leaves a background transparent and words with no ground, so a `person` element that
  // was given no steps (a style forgotten, a Profile not read yet) would draw white initials on nothing. `.person` carries
  // neutral steps made of surface tokens instead, which the style from personStyle() replaces. They are held to every floor.
  it('gives a person with no colour of its own neutral steps from the surface tokens, whose roles hold every floor', () => {
    for (const mode of MODES) {
      const scope = personScope(mode);
      const neutral = { name: 'Neutral', 100: '', 200: '', 300: '', 800: '' };
      for (const step of [100, 200, 300, 800] as const) {
        neutral[step] = evaluate(`var(--person-${step})`, scope);
        expect(neutral[step], `${mode}: --person-${step}`).toMatch(/^#[0-9A-F]{6}$/);
      }
      for (const [role, expected] of Object.entries(personRoles(mode, neutral))) {
        expect(evaluate(`var(--person-${kebab(role)})`, scope), `${mode}: neutral ${role}`).toBe(expected);
      }
      for (const pair of pairsOf(mode, neutral)) {
        expect(contrastRatio(pair.foreground, pair.ground), `${mode}: ${pair.what}`).toBeGreaterThanOrEqual(pair.floor);
      }
    }
  });

  // The build lowers each color-mix() to its first operand where a browser lacks it, so that operand is the colour it is safe to
  // be left with: the card for soft and fill (the words on them stay readable), the 300 for the done disc (so does its picture).
  // look.ts says "the 300 mixed 13% into the card"; the card first at 87% is the same colour.
  it('mixes the dark roles at the percentages look.ts exports, the safe colour first', () => {
    const dark = declarations(":root[data-mode='dark'] .person");
    expect(dark.get('--person-soft')).toBe(`color-mix(in srgb, var(--card) ${100 - DARK_MIX.soft}%, var(--person-300))`);
    expect(dark.get('--person-fill')).toBe(`color-mix(in srgb, var(--card) ${100 - DARK_MIX.fill}%, var(--person-300))`);
    expect(dark.get('--person-done-disc')).toBe(`color-mix(in srgb, var(--person-300) ${100 - DARK_MIX.doneDisc}%, var(--ink))`);
  });

  it('maps every token and every person role to a Tailwind colour once, in @theme inline', () => {
    const theme = css.slice(css.indexOf('@theme inline {'), css.indexOf('}', css.indexOf('@theme inline {')));
    const mapped = new Set([...theme.matchAll(/--color-([\w-]+):\s*var\(--([\w-]+)\);/g)].map((match) => `${match[1]}=${match[2]}`));
    const roles = Object.keys(personRoles('light', FAMILIES[0]!)).map((role) => `person-${kebab(role)}`);
    for (const name of [...Object.keys(TOKENS.light), ...Object.keys(ALIASES), ...roles]) {
      expect(mapped, `--color-${name}`).toContain(`${name}=${name}`);
    }
  });

  it("binds Tailwind's dark variant to the document's mode", () => {
    expect(css).toMatch(/@custom-variant dark \(&:where\(\[data-mode='dark'\], \[data-mode='dark'\] \*\)\);/);
  });

  it('is light on :root and says so to the browser', () => {
    expect(declarations(':root').get('color-scheme')).toBe('light');
    expect(declarations(":root[data-mode='dark']").get('color-scheme')).toBe('dark');
  });

  // Young Serif's default figures are old-style (a 7 hangs below the line, a 2 and a 1 sit at x-height), so wherever the display
  // face is used its figures are lining and tabular. It is one utility, so no caller can forget; a plain `--font-display` in
  // @theme would be a second font-display that leaves them old-style.
  it('draws the display face with lining, tabular figures wherever it is used', () => {
    expect(css.match(/@utility font-display \{/g)).toHaveLength(1);
    const utility = /@utility font-display \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(utility).toMatch(/font-family:\s*'Young Serif'/);
    expect(utility).toMatch(/font-variant-numeric:\s*lining-nums tabular-nums;/);
    expect(css).not.toMatch(/--font-display\s*:/);
  });

  // Nine tickets edit this file side by side: a block or a declaration added beside the ones above would be read by the
  // browser and by no test, so these fail on a second block, a second declaration and an override inside @media.
  it('has each block that holds tokens exactly once', () => {
    for (const selector of [':root', ":root[data-mode='dark']", '.person', ":root[data-mode='dark'] .person", '@theme inline']) {
      expect(blockCount(selector), selector).toBe(1);
    }
  });

  it('declares every token of the table exactly twice, once light and once dark, and nowhere else', () => {
    for (const name of Object.keys(TOKENS.light)) {
      expect(declaredCount(`--${name}`), `--${name}`).toBe(2);
      expect(declarations(':root').has(`--${name}`), `--${name} on :root`).toBe(true);
      expect(declarations(":root[data-mode='dark']").has(`--${name}`), `--${name} in the dark block`).toBe(true);
    }
  });

  it('declares each token that is another token exactly once, on :root', () => {
    for (const name of Object.keys(ALIASES)) {
      expect(declaredCount(`--${name}`), `--${name}`).toBe(1);
      expect(declarations(':root').has(`--${name}`), `--${name} on :root`).toBe(true);
    }
  });

  it("declares each of a person's roles exactly twice, once light and once dark, and nowhere else", () => {
    for (const role of Object.keys(personRoles('light', FAMILIES[0]!))) {
      const name = `--person-${kebab(role)}`;
      expect(declaredCount(name), name).toBe(2);
      expect(declarations('.person').has(name), `${name} on .person`).toBe(true);
      expect(declarations(":root[data-mode='dark'] .person").has(name), `${name} in the dark .person`).toBe(true);
    }
  });

  // The Selected look is one variant, so every part that draws it answers every way a control says it is selected.
  it('has a selected variant for aria-pressed, aria-checked, aria-selected and aria-current page', () => {
    const variant = /@custom-variant selected \((.*)\);/.exec(css)?.[1] ?? '';
    for (const attribute of ["[aria-pressed='true']", "[aria-checked='true']", "[aria-selected='true']", "[aria-current='page']"]) {
      expect(variant, attribute).toContain(attribute);
    }
  });

  it('declares the four neutral steps once on .person, each a token, and the 300 once more for dark', () => {
    const tokens = new Set(Object.keys(TOKENS.light).map((name) => `var(--${name})`));
    for (const step of [100, 200, 300, 800]) {
      const name = `--person-${step}`;
      expect(declaredCount(name), name).toBe(step === 300 ? 2 : 1);
      expect(tokens, `${name} on .person`).toContain(declarations('.person').get(name));
    }
    expect(tokens, '--person-300 in the dark .person').toContain(declarations(":root[data-mode='dark'] .person").get('--person-300'));
  });
});

// ---- docs/look.md: the tables a person reads, equal to look.ts ------------------------------------

const doc = readFileSync(new URL('../docs/look.md', import.meta.url), 'utf8');

// The rows of the markdown table whose header line starts with `header`, as cells with a wrapping pair of backticks taken off.
function table(header: string): string[][] {
  const lines = doc.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(header));
  if (start < 0) throw new Error(`docs/look.md has no table headed "${header}"`);
  const rows: string[][] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break;
    rows.push(line.split('|').slice(1, -1).map((cell) => cell.trim().replace(/^`(.*)`$/, '$1')));
  }
  return rows;
}

describe('docs/look.md', () => {
  it('has the tokens of look.ts, light and dark', () => {
    const rows = table('| Token | Role | Light | Dark |');
    const named = (column: number) => Object.fromEntries(rows.map((row) => [row[0]!.replace(/^--/, ''), row[column]]));
    expect(named(2)).toEqual(TOKENS.light);
    expect(named(3)).toEqual(TOKENS.dark);
  });

  it('has the ten families of look.ts, four steps each, in the palette order', () => {
    const rows = table('| Family | 100 | 200 | 300 (stored) | 800 |');
    expect(rows.map(([name, a, b, c, d]) => ({ name, 100: a, 200: b, 300: c, 800: d }))).toEqual(
      FAMILIES.map((family) => ({ name: family.name, 100: family[100], 200: family[200], 300: family[300], 800: family[800] })),
    );
  });

  it('mixes the dark roles at the percentages look.ts exports', () => {
    const dark = Object.fromEntries(table('| Role | Used for | Light | Dark |').map((row) => [row[0], row[3]]));
    const percent = (cell: string | undefined) => Number(/(\d+)%/.exec(cell ?? '')?.[1]);
    expect(percent(dark['soft'])).toBe(DARK_MIX.soft);
    expect(percent(dark['fill'])).toBe(DARK_MIX.fill);
    expect(percent(dark['done picture'])).toBe(DARK_MIX.doneDisc);
  });

  it('takes the light roles from the steps look.ts takes them from', () => {
    const light = Object.fromEntries(table('| Role | Used for | Light | Dark |').map((row) => [row[0], row[2]!]));
    for (const family of FAMILIES) {
      // A cell names a step of the family (100, 200, 300, 800), `--ink`, or white; "white on 800" is the words, then the ground.
      const step = (cell: string | undefined) => (cell === '--ink' ? TOKENS.light.ink : cell === 'white' ? '#FFFFFF' : family[Number(cell) as keyof Steps]);
      const [onTick, tick] = light['tick']!.split(' on ').map(step);
      const [donePicture, doneDisc] = light['done picture']!.split(' on ').map(step);
      expect(personRoles('light', family), family.name).toMatchObject({
        soft: step(light['soft']),
        fill: step(light['fill']),
        base: step(light['base']),
        onBase: step(light['on base']),
        strong: step(light['strong']),
        onStrong: step(light['on strong']),
        tick,
        onTick,
        doneDisc,
        donePicture,
      });
    }
  });
});

// ---- The button: the Selected look is the variant above, on the two voices that can be selected --------------------

describe('the button', () => {
  const classesOf = (variant: 'primary' | 'secondary' | 'quiet' | 'delete') =>
    /class="([^"]*)"/.exec(renderToStaticMarkup(createElement(Button, { variant })))?.[1]?.split(' ') ?? [];
  const SELECTED = ['bg-accent', 'font-semibold', 'text-foreground', 'ring-2', 'ring-foreground', 'ring-inset'].map((name) => `selected:${name}`);

  it('shows the Selected look on a secondary or quiet button that says so itself', () => {
    for (const variant of ['secondary', 'quiet'] as const) expect(classesOf(variant), variant).toEqual(expect.arrayContaining(SELECTED));
  });

  it('keeps its fill when primary or delete, so its words keep their contrast', () => {
    for (const variant of ['primary', 'delete'] as const) {
      expect(classesOf(variant).filter((name) => name.startsWith('selected:')), variant).toEqual([]);
    }
  });
});
