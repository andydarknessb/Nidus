import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { HouseholdAccountsView as HouseholdAccountsViewType } from '../src/HouseholdAccountsSection';

// The "Who can sign in" card of the phone's settings (src/HouseholdAccountsSection.tsx), rendered to markup so that what is
// asserted is what the browser is given. The section's container reads and writes through src/lib/household-invites.ts; what it
// draws is a function of what it is told, which is what is tested here (the database side is tests/household-invites.test.ts).
// The section imports the Supabase client, which is built on import: nothing here reads, so a placeholder URL and key will do.
let HouseholdAccountsView: typeof HouseholdAccountsViewType;
beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
  ({ HouseholdAccountsView } = await import('../src/HouseholdAccountsSection'));
});

type Props = ComponentProps<typeof HouseholdAccountsViewType>;

const ME = 'user-me';
const OTHER = 'user-other';
const LINK = `https://nidus.example/join/${'ab'.repeat(32)}`;
const nothing = () => undefined;

const accounts = [
  { authUserId: ME, email: 'me@example.com', createdAt: new Date('2026-09-01T12:00:00Z') },
  { authUserId: OTHER, email: 'other@example.com', createdAt: new Date('2026-10-02T03:30:00Z') },
];

const render = (props: Partial<Props> = {}) =>
  renderToStaticMarkup(
    createElement(HouseholdAccountsView, {
      accounts,
      invite: { kind: 'none' },
      userId: ME,
      timezone: 'America/Chicago',
      canShare: true,
      open: null,
      busy: false,
      status: 'idle',
      loadProblem: null,
      problemAt: () => null,
      onOpen: nothing,
      onAskRemove: nothing,
      onCancelRemove: nothing,
      onRemove: nothing,
      onMakeInvite: nothing,
      onCancelInvite: nothing,
      onShare: nothing,
      onCopy: nothing,
      ...props,
    }),
  );

const words = (markup: string) => markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const buttons = (markup: string) => [...markup.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attributes, inner]) => ({ attributes: attributes ?? '', name: words(inner ?? '') }));
const names = (markup: string) => buttons(markup).map(({ name }) => name);
const status = (markup: string) => words(/<p[^>]*role="status"[^>]*>([\s\S]*?)<\/p>/.exec(markup)?.[1] ?? '');

const MADE = { kind: 'made', link: LINK, expiresAt: new Date('2026-10-13T04:30:00Z') } as const;
const WAITING = { kind: 'waiting', expiresAt: new Date('2026-10-13T04:30:00Z') } as const;

describe('Who can sign in: the list', () => {
  it('is a card titled Who can sign in, with a row for each account in the order it is given', () => {
    const markup = render();
    expect(markup).toMatch(/<h2[^>]*>Who can sign in<\/h2>/);
    expect(markup.indexOf('me@example.com')).toBeGreaterThan(-1);
    expect(markup.indexOf('me@example.com')).toBeLessThan(markup.indexOf('other@example.com'));
  });

  it('says You on the signed-in account only, and offers no way to open or remove it', () => {
    const markup = render();
    expect(markup.match(/>You</g)).toHaveLength(1);
    expect(markup.indexOf('>You<')).toBeLessThan(markup.indexOf('other@example.com'));
    expect(names(markup).some((name) => name.includes('me@example.com'))).toBe(false);
    expect(names(markup).some((name) => name.includes('other@example.com'))).toBe(true);
    expect(markup).not.toContain(`account-${ME}`);
  });

  it('says since when, in the Household Timezone and not the machine one', () => {
    // 03:30 UTC on Oct 2 is the evening of Oct 1 in Chicago, and already Oct 2 in Sydney.
    expect(words(render())).toContain('Since Thu, Oct 1');
    expect(words(render({ timezone: 'Australia/Sydney' }))).toContain('Since Fri, Oct 2');
    expect(words(render())).toContain('Since Tue, Sep 1');
  });

  it('draws the other account as a closed 56 px row that opens to Remove, and the Remove button only when it is open', () => {
    const closed = render();
    expect(buttons(closed).find(({ name }) => name.includes('other@example.com'))?.attributes).toContain('aria-expanded="false"');
    expect(names(closed)).not.toContain('Remove other@example.com');
    const open = render({ open: { id: OTHER, confirming: false } });
    expect(buttons(open).find(({ name }) => name.includes('other@example.com'))?.attributes).toContain('aria-expanded="true"');
    expect(names(open)).toContain('Remove other@example.com');
  });

  it('asks before removing, in the spec words, with Remove and Cancel', () => {
    const markup = render({ open: { id: OTHER, confirming: true } });
    expect(words(markup)).toContain('Remove other@example.com? They will no longer be able to open Settings or the calendar with this Google account.');
    expect(names(markup).slice(-5)).toContain('Cancel');
    expect(names(markup)).toContain('Remove');
    expect(names(markup)).not.toContain('Remove other@example.com');
  });

  it('switches the question off while the removal is on its way, with aria-disabled and never disabled', () => {
    const markup = render({ open: { id: OTHER, confirming: true }, busy: true });
    const answers = buttons(markup).filter(({ name }) => name === 'Cancel' || name === 'Remove');
    expect(answers).toHaveLength(2);
    for (const { attributes } of answers) expect(attributes).toContain('aria-disabled="true"');
    expect(markup).not.toMatch(/\sdisabled(=|\s|>)/);
  });

  it('says what a removal that failed said, under its question, and a trouble reading as an alert', () => {
    const problem = { place: `remove-${OTHER}`, words: 'That did not save. Try again.', n: 1, refused: false };
    const markup = render({ open: { id: OTHER, confirming: true }, problemAt: (place) => (place === problem.place ? problem : null) });
    expect(markup).toMatch(/role="alert"[^>]*>That did not save\. Try again\./);
    expect(render({ loadProblem: 'Could not load who can sign in. Check your connection.' })).toMatch(/role="alert"[^>]*>Could not load who can sign in\./);
  });

  it('draws no rows and no invite before the first read lands', () => {
    const markup = render({ accounts: null, invite: null });
    expect(markup).toMatch(/<h2[^>]*>Who can sign in<\/h2>/);
    expect(buttons(markup)).toEqual([]);
  });
});

describe('Who can sign in: the invite', () => {
  it('with none waiting is one full width Invite someone button, and nothing else about invites', () => {
    const markup = render();
    expect(names(markup)).toEqual(['other@example.com Since Thu, Oct 1', 'Invite someone']);
    expect(buttons(markup).find(({ name }) => name === 'Invite someone')?.attributes).toMatch(/class="[^"]*\bw-full\b/);
    expect(words(markup)).not.toContain('Invite link');
    expect(words(markup)).not.toContain('An invite is waiting');
  });

  it('just made shows the link read-only, the line with its date, Share and Copy, then a quiet Cancel invite', () => {
    const markup = render({ invite: MADE });
    expect(markup).toMatch(new RegExp(`<input[^>]*readOnly=""[^>]*value="${LINK}"|<input[^>]*value="${LINK}"[^>]*readOnly=""`));
    expect(markup).toMatch(/Invite link<\/span>/);
    expect(words(markup)).toContain('Send this link to one person. It works once, until Mon, Oct 12.');
    const tail = names(markup).slice(-3);
    expect(tail).toEqual(['Share', 'Copy', 'Cancel invite']);
    expect(buttons(markup).find(({ name }) => name === 'Cancel invite')?.attributes).toMatch(/class="[^"]*\btext-muted-foreground\b/);
    expect(names(markup)).not.toContain('Invite someone');
  });

  it('draws Share only when the phone can share', () => {
    expect(names(render({ invite: MADE, canShare: true }))).toContain('Share');
    const without = render({ invite: MADE, canShare: false });
    expect(names(without)).not.toContain('Share');
    expect(names(without)).toContain('Copy');
  });

  it('writes the expiry in the Household Timezone', () => {
    // 04:30 UTC on Oct 13 is still Oct 12 in Chicago.
    expect(words(render({ invite: MADE }))).toContain('until Mon, Oct 12.');
    expect(words(render({ invite: MADE, timezone: 'Asia/Tokyo' }))).toContain('until Tue, Oct 13.');
    expect(words(render({ invite: WAITING }))).toContain('An invite is waiting, until Mon, Oct 12.');
  });

  it('waiting, after a reload, says so and offers Make a new link and Cancel invite, without the link', () => {
    const markup = render({ invite: WAITING });
    expect(words(markup)).toContain('An invite is waiting, until Mon, Oct 12.');
    expect(names(markup).slice(-2)).toEqual(['Make a new link', 'Cancel invite']);
    expect(markup).not.toContain('<input');
    expect(names(markup)).not.toContain('Copy');
    expect(names(markup)).not.toContain('Invite someone');
  });

  it('says Copied after a copy and Invite cancelled. after a cancel, in the one status line that is always there', () => {
    for (const state of ['idle', 'copied', 'cancelled'] as const) expect(render({ status: state }).split('role="status"')).toHaveLength(2);
    expect(status(render({ status: 'idle' }))).toBe('');
    expect(status(render({ invite: MADE, status: 'copied' }))).toBe('Copied');
    expect(status(render({ status: 'cancelled' }))).toBe('Invite cancelled.');
    expect(names(render({ status: 'cancelled' }))).toContain('Invite someone');
  });

  it('switches its writes off while one is on its way, with aria-disabled and never disabled', () => {
    for (const invite of [{ kind: 'none' }, MADE, WAITING] as const) {
      const markup = render({ invite, busy: true });
      const writes = buttons(markup).filter(({ name }) => ['Invite someone', 'Make a new link', 'Cancel invite'].includes(name));
      expect(writes.length, invite.kind).toBeGreaterThan(0);
      for (const { attributes } of writes) expect(attributes, invite.kind).toContain('aria-disabled="true"');
      expect(markup, invite.kind).not.toMatch(/\sdisabled(=|\s|>)/);
    }
  });

  it('says what a failed invite said, under its buttons', () => {
    const problem = { place: 'invite', words: 'No internet, so that did not go through. Try again soon.', n: 1, refused: false };
    const markup = render({ invite: WAITING, problemAt: (place) => (place === 'invite' ? problem : null) });
    expect(markup).toMatch(/role="alert"[^>]*>No internet/);
    expect(markup.indexOf('Cancel invite')).toBeLessThan(markup.indexOf('role="alert"'));
  });
});

describe('Who can sign in: its words', () => {
  const STATES: Partial<Props>[] = [
    {},
    { open: { id: OTHER, confirming: false } },
    { open: { id: OTHER, confirming: true } },
    { invite: MADE },
    { invite: WAITING },
    { status: 'copied', invite: MADE },
    { status: 'cancelled' },
  ];

  it('are plain, with no em-dash or en-dash, in every state', () => {
    for (const state of STATES) expect(render(state), JSON.stringify(state)).not.toMatch(/[–—]/);
  });

  it('keep every button 52 px tall or more and every colour to the tokens', () => {
    for (const state of STATES) {
      const markup = render(state);
      expect(markup, JSON.stringify(state)).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgb\(|style="[^"]*color/);
      for (const { attributes, name } of buttons(markup)) expect(attributes, name).toMatch(/\b(h-14|min-h-14|h-12|size-12)\b|class="[^"]*\bh-\[?(1[2-9]|[2-9]\d)/);
    }
  });
});
