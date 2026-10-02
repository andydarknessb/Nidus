import type { CSSProperties } from 'react';
import { PROFILE_PALETTE } from './profiles';

// The look (docs/look.md) as data: the tokens of both modes, the ten colour families a Profile's colour belongs to,
// and what a person's colour becomes in each mode. src/index.css holds the same values for the browser.
// tests/look.test.ts reads it and fails when the two disagree, and holds every pair of words and ground, and every
// shape, to its contrast floor in both modes. Nothing here is read to draw a screen except personStyle() and the
// page colours of applyMode(); components take their colours from the classes index.css maps.

export type Mode = 'light' | 'dark';

// docs/look.md, Modes. The scrim is the one value that is not a hex: nothing is read on it.
const LIGHT = {
  background: '#F1F4F9',
  card: '#FFFFFF',
  muted: '#ECF0F6',
  accent: '#DCE3EE',
  border: '#DCE3EE',
  input: '#667085',
  foreground: '#182031',
  'muted-foreground': '#384256',
  ink: '#182031',
  primary: '#182031',
  'primary-foreground': '#FFFFFF',
  destructive: '#991B1B',
  'destructive-foreground': '#FFFFFF',
  everyone: '#EEE6D8',
  ring: '#182031',
  scrim: 'rgb(24 32 49 / 50%)',
} as const;

export type TokenName = keyof typeof LIGHT;

const DARK: Record<TokenName, string> = {
  background: '#0E1016',
  card: '#171A22',
  muted: '#20242F',
  accent: '#2A2F3C',
  border: '#2A2F3C',
  input: '#7C8499',
  foreground: '#F5F2EA',
  'muted-foreground': '#C3C7D4',
  ink: '#111318',
  primary: '#F5F2EA',
  'primary-foreground': '#111318',
  destructive: '#991B1B',
  'destructive-foreground': '#F5F2EA',
  everyone: '#3A342C',
  ring: '#F5F2EA',
  scrim: 'rgb(0 0 0 / 60%)',
};

export const TOKENS: Record<Mode, Record<TokenName, string>> = { light: LIGHT, dark: DARK };

// Tokens that are another token in both modes (docs/look.md, under Modes).
export const ALIASES = {
  secondary: 'muted',
  popover: 'card',
  'card-foreground': 'foreground',
  'popover-foreground': 'foreground',
  'secondary-foreground': 'foreground',
  'accent-foreground': 'foreground',
} as const satisfies Record<string, TokenName>;

// ---- People -------------------------------------------------------------------

export type Family = (typeof PROFILE_PALETTE)[number]['name'];

// The steps the look takes from each family besides the 300, which a Profile stores and the palette holds.
const STEPS: Record<Family, { 100: string; 200: string; 800: string }> = {
  Red: { 100: '#FEE2E2', 200: '#FECACA', 800: '#991B1B' },
  Orange: { 100: '#FFEDD5', 200: '#FED7AA', 800: '#9A3412' },
  Amber: { 100: '#FEF3C7', 200: '#FDE68A', 800: '#92400E' },
  Lime: { 100: '#ECFCCB', 200: '#D9F99D', 800: '#3F6212' },
  Emerald: { 100: '#D1FAE5', 200: '#A7F3D0', 800: '#065F46' },
  Cyan: { 100: '#CFFAFE', 200: '#A5F3FC', 800: '#155E75' },
  Sky: { 100: '#E0F2FE', 200: '#BAE6FD', 800: '#075985' },
  Blue: { 100: '#DBEAFE', 200: '#BFDBFE', 800: '#1E40AF' },
  Violet: { 100: '#EDE9FE', 200: '#DDD6FE', 800: '#5B21B6' },
  Pink: { 100: '#FCE7F3', 200: '#FBCFE8', 800: '#9D174D' },
};

export type FamilySteps = { name: Family; 100: string; 200: string; 300: string; 800: string };

// The ten families in the palette's order, each with the four steps the look uses.
export const FAMILIES: readonly FamilySteps[] = PROFILE_PALETTE.map(({ name, hex }) => ({ name, ...STEPS[name], 300: hex.toUpperCase() }));

// What mixes into what for the dark roles, in percent (docs/look.md, People): the family's 300 into --card for
// soft and fill, and --ink into the 300 for the disc behind a finished tile's picture. index.css writes the same
// mixes with the safe colour first, so a browser without color-mix, which keeps the first operand, is left with the
// card or the 300: the card at 100 - 13 and 100 - 28 percent, the 300 at 100 - 20. The colours are the same.
export const DARK_MIX = { soft: 13, fill: 28, doneDisc: 20 } as const;

export type PersonRoles = {
  soft: string;
  fill: string;
  base: string;
  onBase: string;
  strong: string;
  onStrong: string;
  tick: string;
  onTick: string;
  doneDisc: string;
  donePicture: string;
};

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// `percent` of `a` mixed into `b`, both #RRGGBB: what color-mix(in srgb, a percent%, b) draws.
export function mix(a: string, percent: number, b: string): string {
  const [from, into] = [rgb(a), rgb(b)] as const;
  const channels = from.map((value, i) => Math.round((value * percent + into[i]! * (100 - percent)) / 100));
  return `#${channels.map((value) => value.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

// What a person's colour becomes in a mode (docs/look.md, People). index.css derives the same roles from the four
// steps on an element with the class `person`.
export function personRoles(mode: Mode, family: FamilySteps): PersonRoles {
  const t = TOKENS[mode];
  if (mode === 'light') {
    return {
      soft: family[100],
      fill: family[200],
      base: family[300],
      onBase: t.ink,
      strong: family[800],
      onStrong: '#FFFFFF',
      tick: family[800],
      onTick: '#FFFFFF',
      doneDisc: family[100],
      donePicture: family[800],
    };
  }
  return {
    soft: mix(family[300], DARK_MIX.soft, t.card),
    fill: mix(family[300], DARK_MIX.fill, t.card),
    base: family[300],
    onBase: t.ink,
    strong: family[300],
    onStrong: t.ink,
    tick: t.ink,
    onTick: family[300],
    doneDisc: mix(t.ink, DARK_MIX.doneDisc, family[300]),
    donePicture: t.ink,
  };
}

// The family of a stored colour: the one whose 300 step it is, or, for a colour that is not in the palette, the
// nearest by distance in sRGB.
export function familyOf(color: string): FamilySteps {
  const [r, g, b] = rgb(color);
  const distance = (family: FamilySteps) => {
    const [fr, fg, fb] = rgb(family[300]);
    return (fr - r) ** 2 + (fg - g) ** 2 + (fb - b) ** 2;
  };
  return FAMILIES.reduce((best, family) => (distance(family) < distance(best) ? family : best));
}

// The four custom properties a person's roles are derived from. Put them on an element with the class `person`:
//   <li className="person" style={personStyle(profile.color)}>
export function personStyle(color: string): CSSProperties {
  const family = familyOf(color);
  return { '--person-100': family[100], '--person-200': family[200], '--person-300': family[300], '--person-800': family[800] } as CSSProperties;
}
