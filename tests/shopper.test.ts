import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it } from 'vitest';
import { principalOf } from '../supabase/functions/_shared/edge.ts';
import { handleShopper, type ShopperDeps } from '../supabase/functions/shopper/handler.ts';
import { PROFILE_PALETTE, createProfile } from '../src/lib/profiles';
import { setMeal } from '../src/lib/meals';
import { addItem, createList } from '../src/lib/shared-lists';
import { addDays, dayStartMs, householdDay } from '@shared/zoned-time.ts';
import {
  asDevice,
  asHouseholdAccount,
  asServiceRole,
  asTablet,
  createHousehold,
  destroyHousehold,
  destroyTablet,
  type HouseholdAccount,
  type Tablet,
} from './support/supabase';

// The shopper (spec 0019, ticket 3): Claude, faked as the injected fetch, suggests groceries for one list from the Meals of the next
// seven days, and the answer replaces the list's waiting List Suggestions. The database is the local stack, never mocked.

let households: HouseholdAccount[] = [];
let tablets: Tablet[] = [];

afterEach(async () => {
  for (const tablet of tablets) await destroyTablet(tablet);
  for (const account of households) await destroyHousehold(account);
  households = [];
  tablets = [];
});

const HOUR = 60 * 60 * 1000;

// Anthropic's streamed answer to one text reply, as the SDK reads it.
function streamed(text: string, stopReason = 'end_turn'): Response {
  const events: [string, unknown][] = [
    ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 5 } }],
    ['message_stop', { type: 'message_stop' }],
  ];
  const body = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

// Claude's answer for these items, for the Tacos the fixture plans.
const suggest = (...texts: string[]) => JSON.stringify({ items: texts.map((text) => ({ text, for_meals: 'Tacos' })) });

// Anthropic's API faked as the injected fetch. Each request's body is kept for the assertions.
function fakeClaude(reply: (init: RequestInit) => Response | Promise<Response> = () => streamed(suggest('Tortillas'))) {
  const requests: { model?: unknown; output_config?: { effort?: unknown }; [key: string]: unknown }[] = [];
  const fetch = async (_input: unknown, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    return reply(init ?? {});
  };
  return { fetch: fetch as unknown as typeof globalThis.fetch, requests };
}

type Claude = ReturnType<typeof fakeClaude>;

async function tokenOf(client: SupabaseClient): Promise<string> {
  const { data } = await client.auth.getSession();
  if (!data.session) throw new Error('no session');
  return data.session.access_token;
}

function askFrom(token: string | null, listId: string): Request {
  return new Request('https://functions.test/shopper', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ list_id: listId }),
  });
}

function ask(claude: Claude, token: string | null, listId: string, deps: Partial<ShopperDeps> = {}): Promise<Response> {
  return handleShopper(askFrom(token, listId), { admin: asServiceRole(), apiKey: 'test-key', fetch: claude.fetch, ...deps });
}

// A Household with a Household Account, a paired Device, a list with 'Milk' on it and one planned dinner the day after today.
async function setUp({ meal = true, name }: { meal?: boolean; name?: string } = {}) {
  const account = await createHousehold(name);
  households.push(account);
  const phone = await asHouseholdAccount(account);
  const tablet = await asDevice(account, 'Kitchen');
  tablets.push(tablet);
  const list = await createList(phone, account.household.id, 'Groceries', 0);
  await addItem(phone, list.id, 'Milk', 0);
  const today = householdDay(account.household.timezone).date;
  if (meal) await setMeal(phone, addDays(today, 1), 'dinner', 'Tacos');
  return { account, phone, tablet, list, today };
}

async function waitingTexts(client: SupabaseClient, listId: string): Promise<string[]> {
  const { data, error } = await client.from('list_suggestions').select('text').eq('list_id', listId).order('sort_order');
  expect(error).toBeNull();
  return (data ?? []).map((row) => row.text);
}

async function arrangeWaiting(listId: string, texts: string[]): Promise<void> {
  const { error } = await asServiceRole()
    .from('list_suggestions')
    .insert(texts.map((text, sort_order) => ({ list_id: listId, text, for_meals: null, sort_order })));
  expect(error).toBeNull();
}

async function countRuns(account: HouseholdAccount): Promise<number> {
  const { count, error } = await asServiceRole()
    .from('shopper_runs')
    .select('id', { count: 'exact', head: true })
    .eq('household_id', account.household.id);
  expect(error).toBeNull();
  return count ?? 0;
}

async function arrangeRuns(account: HouseholdAccount, times: number[]): Promise<void> {
  const { error } = await asServiceRole()
    .from('shopper_runs')
    .insert(times.map((ms) => ({ household_id: account.household.id, ran_at: new Date(ms).toISOString() })));
  expect(error).toBeNull();
}

describe('principalOf', () => {
  it('gives the Household of a Household Account and of a paired Device, and refuses an unpaired session, a bad token and no session', async () => {
    const account = await createHousehold();
    households.push(account);
    const phone = await asHouseholdAccount(account);
    const device = await asDevice(account);
    tablets.push(device);
    const visitor = await asTablet();
    tablets.push(visitor);
    const admin = asServiceRole();
    const from = (token?: string) => new Request('https://functions.test/', { headers: token ? { Authorization: `Bearer ${token}` } : {} });

    expect(await principalOf(from(await tokenOf(phone)), admin)).toEqual({ householdId: account.household.id });
    expect(await principalOf(from(await tokenOf(device.client)), admin)).toEqual({ householdId: account.household.id });

    const unpaired = await principalOf(from(await tokenOf(visitor.client)), admin);
    expect(unpaired).toBeInstanceOf(Response);
    expect((unpaired as Response).status).toBe(403);

    const bad = await principalOf(from('not-a-session'), admin);
    expect((bad as Response).status).toBe(401);
    const none = await principalOf(from(), admin);
    expect((none as Response).status).toBe(401);
  });
});

describe('the shopper', () => {
  it('a Household Account gets suggestions, in the order Claude gave them, with the Meal each is for', async () => {
    const { phone, list } = await setUp();
    const claude = fakeClaude(() => streamed(JSON.stringify({ items: [{ text: 'Ground beef, 2 lb', for_meals: 'Tacos' }, { text: 'Tortillas', for_meals: 'Tacos' }] })));

    const response = await ask(claude, await tokenOf(phone), list.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: 'suggested', count: 2 });
    const { data } = await phone.from('list_suggestions').select('text, for_meals').eq('list_id', list.id).order('sort_order');
    expect(data).toEqual([
      { text: 'Ground beef, 2 lb', for_meals: 'Tacos' },
      { text: 'Tortillas', for_meals: 'Tacos' },
    ]);
  });

  it('a Device gets suggestions too', async () => {
    const { tablet, list } = await setUp();
    const claude = fakeClaude(() => streamed(suggest('Tortillas')));

    const response = await ask(claude, await tokenOf(tablet.client), list.id);
    expect(await response.json()).toEqual({ outcome: 'suggested', count: 1 });
    expect(await waitingTexts(tablet.client, list.id)).toEqual(['Tortillas']);
  });

  it('refuses an unpaired session, a stranger and a list of another Household, with no request to Claude and no run', async () => {
    const { account, list } = await setUp();
    const visitor = await asTablet();
    tablets.push(visitor);
    const other = await createHousehold();
    households.push(other);
    const stranger = await asHouseholdAccount(other);
    const claude = fakeClaude();

    expect((await ask(claude, await tokenOf(visitor.client), list.id)).status).toBe(403);
    expect((await ask(claude, await tokenOf(stranger), list.id)).status).toBe(403);
    expect((await ask(claude, null, list.id)).status).toBe(401);
    expect(claude.requests).toHaveLength(0);
    expect(await countRuns(account)).toBe(0);
  });

  it('answers not-set-up without a key, with no request to Claude and no run', async () => {
    const { account, phone, list } = await setUp();
    const claude = fakeClaude();

    const response = await ask(claude, await tokenOf(phone), list.id, { apiKey: undefined });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ outcome: 'not-set-up' });
    expect(claude.requests).toHaveLength(0);
    expect(await countRuns(account)).toBe(0);
  });

  it('with no Meals in the seven days, answers no-meals with no request to Claude and no run', async () => {
    const { account, phone, list } = await setUp({ meal: false });
    const claude = fakeClaude();

    const response = await ask(claude, await tokenOf(phone), list.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: 'no-meals' });
    expect(claude.requests).toHaveLength(0);
    expect(await countRuns(account)).toBe(0);
  });

  it('refuses the eleventh run of a Household Date, and a run counts once Claude is asked', async () => {
    const { account, phone, list } = await setUp();
    const token = await tokenOf(phone);
    const claude = fakeClaude();

    for (let run = 0; run < 10; run += 1) expect((await ask(claude, token, list.id)).status).toBe(200);
    const refused = await ask(claude, token, list.id);
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ outcome: 'limit' });
    expect(claude.requests).toHaveLength(10);
    expect(await countRuns(account)).toBe(10);
  });

  it('lets exactly ten asks a Household Date through when fifteen come at once', async () => {
    const { account, phone, list } = await setUp();
    const token = await tokenOf(phone);
    const claude = fakeClaude();

    const responses = await Promise.all(Array.from({ length: 15 }, () => ask(claude, token, list.id)));
    const statuses = responses.map((response) => response.status);
    const passed = statuses.filter((status) => status === 200).length;
    expect(passed).toBe(10);
    expect(statuses.filter((status) => status === 429)).toHaveLength(5);
    expect(claude.requests).toHaveLength(passed);
    expect(await countRuns(account)).toBe(passed);
  });

  it('counts the runs of a Household Date from Household midnight, not UTC midnight', async () => {
    const { account, phone, list, today } = await setUp();
    const midnight = dayStartMs(today, account.household.timezone);
    const utcMidnight = Date.parse(`${today}T00:00:00Z`);
    // Ten runs after UTC midnight but before Household midnight (Chicago is six hours behind UTC): they belong to the day before.
    await arrangeRuns(account, Array.from({ length: 10 }, () => utcMidnight + HOUR));
    const claude = fakeClaude();

    const response = await ask(claude, await tokenOf(phone), list.id, { now: () => midnight + HOUR });
    expect(response.status).toBe(200);
    expect(claude.requests).toHaveLength(1);
  });

  it('checks the answer: drops what the list has (in any case), a repeat, a blank and one over 200 characters, and keeps the first forty', async () => {
    const { phone, list } = await setUp();
    const more = Array.from({ length: 45 }, (_, n) => `Item ${n + 1}`);
    const answer = {
      items: [
        { text: 'MILK', for_meals: 'Tacos' },
        { text: 'Eggs', for_meals: 'Tacos' },
        { text: 'eggs', for_meals: 'Chili' },
        { text: '  \t ', for_meals: 'Tacos' },
        { text: 'x'.repeat(201), for_meals: 'Tacos' },
        { text: 'Rice', for_meals: 'y'.repeat(130) },
        ...more.map((text) => ({ text, for_meals: '' })),
      ],
    };
    const claude = fakeClaude(() => streamed(JSON.stringify(answer)));

    const response = await ask(claude, await tokenOf(phone), list.id);
    expect(await response.json()).toEqual({ outcome: 'suggested', count: 40 });
    const { data } = await phone.from('list_suggestions').select('text, for_meals').eq('list_id', list.id).order('sort_order');
    expect(data?.map((row) => row.text)).toEqual(['Eggs', 'Rice', ...more.slice(0, 38)]);
    expect(data?.[1]?.for_meals).toHaveLength(120);
    expect(data?.[2]?.for_meals).toBeNull();
  });

  it('checks the answer against the items to get: a crossed-off item the Meals need again is kept, one still to get is dropped', async () => {
    const { phone, list } = await setUp();
    await addItem(phone, list.id, 'Eggs', 1);
    await asServiceRole().from('list_items').update({ crossed_at: new Date().toISOString() }).eq('list_id', list.id).eq('text', 'Eggs');
    const claude = fakeClaude(() => streamed(suggest('Eggs', 'Milk', 'Tortillas')));

    const response = await ask(claude, await tokenOf(phone), list.id);
    expect(await response.json()).toEqual({ outcome: 'suggested', count: 2 });
    expect(await waitingTexts(phone, list.id)).toEqual(['Eggs', 'Tortillas']);
  });

  it.each([
    ['an error from Claude', () => new Response(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'boom' } }), { status: 500, headers: { 'content-type': 'application/json' } })],
    ['a refusal', () => streamed(suggest('Ham'), 'refusal')],
    ['an answer stopped at its length', () => streamed(suggest('Ham'), 'max_tokens')],
    ['a body that is not the schema', () => streamed('{"items":"nope"}')],
    ['text that is not JSON', () => streamed('Sure! Here is a list.')],
  ])('%s answers failed, changes nothing and counts the run', async (_, reply) => {
    const { account, phone, list } = await setUp();
    await arrangeWaiting(list.id, ['Tortillas']);
    const claude = fakeClaude(reply);

    const response = await ask(claude, await tokenOf(phone), list.id);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ outcome: 'failed' });
    expect(await waitingTexts(phone, list.id)).toEqual(['Tortillas']);
    expect(await countRuns(account)).toBe(1);
  });

  it('a call that outlasts the time limit answers failed, changes nothing and counts the run', async () => {
    const { account, phone, list } = await setUp();
    await arrangeWaiting(list.id, ['Tortillas']);
    const claude = fakeClaude((init) => new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('timed out')))));

    const response = await ask(claude, await tokenOf(phone), list.id, { limitMs: 50 });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ outcome: 'failed' });
    expect(await waitingTexts(phone, list.id)).toEqual(['Tortillas']);
    expect(await countRuns(account)).toBe(1);
  });

  it('asking again replaces the waiting suggestions', async () => {
    const { phone, list } = await setUp();
    await arrangeWaiting(list.id, ['Tortillas']);
    const claude = fakeClaude(() => streamed(suggest('Ground beef, 2 lb')));

    expect(await (await ask(claude, await tokenOf(phone), list.id)).json()).toEqual({ outcome: 'suggested', count: 1 });
    expect(await waitingTexts(phone, list.id)).toEqual(['Ground beef, 2 lb']);
  });

  it('two runs at once leave one set, never both', async () => {
    const { phone, list } = await setUp();
    const token = await tokenOf(phone);
    const first = fakeClaude(() => streamed(suggest('Apples')));
    const second = fakeClaude(() => streamed(suggest('Bread crumbs', 'Cheese')));

    const responses = await Promise.all([ask(first, token, list.id), ask(second, token, list.id)]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const left = await waitingTexts(phone, list.id);
    expect([['Apples'], ['Bread crumbs', 'Cheese']]).toContainEqual(left);
  });

  it('nothing new leaves the waiting suggestions as they were', async () => {
    const { account, phone, list } = await setUp();
    await arrangeWaiting(list.id, ['Tortillas']);
    const claude = fakeClaude(() => streamed(suggest('milk')));

    const response = await ask(claude, await tokenOf(phone), list.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: 'nothing-new' });
    expect(await waitingTexts(phone, list.id)).toEqual(['Tortillas']);
    expect(await countRuns(account)).toBe(1);
  });

  it('asks Claude with claude-haiku-5-5 at effort max, no sampling parameters, and no Profile, event, Routine or Household name', async () => {
    const { account, phone, list, today } = await setUp({ name: 'Zebra Household' });
    const admin = asServiceRole();
    await createProfile(phone, account.household.id, { name: 'Quincy', color: PROFILE_PALETTE[0]!.hex }, 0);
    const { error: eventError } = await admin.from('native_events').insert({
      household_id: account.household.id,
      title: 'Quokka Dentist',
      starts_at: new Date(Date.now() + HOUR).toISOString(),
      ends_at: new Date(Date.now() + 2 * HOUR).toISOString(),
    });
    expect(eventError).toBeNull();
    const { data: profile } = await admin.from('profiles').select('id').eq('household_id', account.household.id).single<{ id: string }>();
    const { error: routineError } = await admin
      .from('routines')
      .insert({ household_id: account.household.id, profile_id: profile!.id, title: 'Juniper Vitamin', days_of_week: 1 });
    expect(routineError).toBeNull();
    await addItem(phone, list.id, 'Eggs', 1);
    await admin.from('list_items').update({ crossed_at: new Date().toISOString() }).eq('list_id', list.id).eq('text', 'Eggs');
    const claude = fakeClaude();

    expect((await ask(claude, await tokenOf(phone), list.id)).status).toBe(200);
    const sent = claude.requests[0]!;
    expect(sent['model']).toBe('claude-haiku-5-5');
    expect(sent['output_config']?.effort).toBe('max');
    for (const sampling of ['temperature', 'top_p', 'top_k']) expect(sent).not.toHaveProperty(sampling);
    const body = JSON.stringify(sent);
    for (const hidden of ['Zebra Household', 'Quincy', 'Quokka Dentist', 'Juniper Vitamin']) expect(body).not.toContain(hidden);
    // The Meal goes as its weekday and slot, the items to get as a list, and the Profile count: a crossed-off item is not sent.
    const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(`${addDays(today, 1)}T12:00:00Z`).getUTCDay()];
    expect(body).toContain(`${weekday} dinner: Tacos`);
    expect(body).toContain('Items to get:\\n- Milk');
    expect(body).not.toContain('Eggs');
    expect(body).toContain('People in the household: 1');
  });
});

describe('the shopper data', () => {
  it('lets only the service role replace a list\'s suggestions, and no principal read the runs', async () => {
    const { account, phone, tablet, list } = await setUp();
    const items = [{ text: 'Tortillas', for_meals: null }];

    for (const client of [phone, tablet.client]) {
      const { error } = await client.rpc('replace_list_suggestions', { p_list_id: list.id, p_items: items });
      expect(error?.code).toBe('42501');
      const { error: readError } = await client.from('shopper_runs').select('id');
      expect(readError).not.toBeNull();
    }

    const { data: count, error } = await asServiceRole().rpc('replace_list_suggestions', { p_list_id: list.id, p_items: items });
    expect(error).toBeNull();
    expect(count).toBe(1);
    expect(await waitingTexts(phone, list.id)).toEqual(['Tortillas']);
    expect(await countRuns(account)).toBe(0);
  });
});
