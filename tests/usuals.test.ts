import { afterEach, describe, expect, it } from 'vitest';
import { LINK_WORDS, createUsual, deleteUsual, isTakenName, loadUsuals, updateUsual, usualKey, usualProblem, type Usual, type UsualInput } from '../src/lib/usuals';
import { asAnonymous, asDevice, asHouseholdAccount, createHousehold, destroyHousehold, destroyTablet, type HouseholdAccount, type Tablet } from './support/supabase';

// Usuals (spec 0019, ticket 4): the product the Household buys for an item, by its name. The form's own check is pure; the rules the
// database keeps (a Household Account writes, every principal of the Household reads, one name per Household) run against the local stack.

const TARGET = 'https://www.target.com/p/good-gather-2-milk/-/A-12345';
const input = (overrides: Partial<UsualInput> = {}): UsualInput => ({ name: 'Milk', product: 'Good & Gather 2% milk', target_link: '', ...overrides });

describe('usualProblem', () => {
  it('says nothing of a Usual that is fine, nor of a blank name (the form row asks for that)', () => {
    expect(usualProblem(input(), [], null)).toBeNull();
    expect(usualProblem(input({ name: '   ' }), [], null)).toBeNull();
  });

  it('says what is wrong when the product is blank, and names the product field', () => {
    expect(usualProblem(input({ product: '  ' }), [], null)).toEqual({ field: 'product', words: 'Say what the product is.' });
  });

  it("refuses a link that is not a Target product link, and one past 500 characters, naming the link field", () => {
    const linkProblem = { field: 'target_link', words: LINK_WORDS };
    expect(usualProblem(input({ target_link: 'https://example.com/p/milk' }), [], null)).toEqual(linkProblem);
    expect(usualProblem(input({ target_link: 'https://www.target.com/s?searchTerm=milk' }), [], null)).toEqual(linkProblem);
    expect(usualProblem(input({ target_link: `https://www.target.com/p/${'x'.repeat(490)}` }), [], null)).toEqual(linkProblem);
  });

  it('accepts a Target product link, and no link at all', () => {
    expect(usualProblem(input({ target_link: TARGET }), [], null)).toBeNull();
    expect(usualProblem(input({ target_link: '  ' }), [], null)).toBeNull();
  });

  it('refuses a name the Household already has, in any case or spacing, and lets a Usual keep its own name', () => {
    const others: Usual[] = [{ id: 'a', name: 'Milk', product: 'Good & Gather 2% milk', target_link: null }];
    expect(usualProblem(input({ name: '  MILK ' }), others, null)).toEqual({ field: 'name', words: 'You already have a usual for MILK.' });
    expect(usualProblem(input({ name: 'Milk' }), others, 'a')).toBeNull();
  });
});

describe('usualKey', () => {
  it('reads a name as the database does: trimmed, runs of spaces as one, ignoring case', () => {
    expect(usualKey('  Whole   Milk ')).toBe('whole milk');
    expect(usualKey('Whole milk')).toBe(usualKey('whole  MILK'));
  });
});

describe('isTakenName', () => {
  it('is true for the database refusing a name the Household has, and for nothing else', () => {
    expect(isTakenName({ code: '23505' })).toBe(true);
    expect(isTakenName({ code: '23514' })).toBe(false);
    expect(isTakenName(new Error('network'))).toBe(false);
    expect(isTakenName(null)).toBe(false);
  });
});

describe('usuals in the database', () => {
  const households: HouseholdAccount[] = [];
  const tablets: Tablet[] = [];

  afterEach(async () => {
    for (const tablet of tablets.splice(0)) await destroyTablet(tablet);
    for (const account of households.splice(0)) await destroyHousehold(account);
  });

  async function arrange() {
    const account = await createHousehold();
    households.push(account);
    return { account, phone: await asHouseholdAccount(account) };
  }

  it('a Household Account creates, changes and deletes Usuals, with the name trimmed', async () => {
    const { account, phone } = await arrange();
    await createUsual(phone, account.household.id, { name: '  Milk ', product: 'Good & Gather 2% milk, 1 gallon', target_link: TARGET });
    const [created] = await loadUsuals(phone);
    expect(created).toMatchObject({ name: 'Milk', product: 'Good & Gather 2% milk, 1 gallon', target_link: TARGET });

    await updateUsual(phone, created!.id, { name: 'Milk', product: 'Organic whole milk', target_link: '' });
    expect(await loadUsuals(phone)).toMatchObject([{ product: 'Organic whole milk', target_link: null }]);

    await deleteUsual(phone, created!.id);
    expect(await loadUsuals(phone)).toEqual([]);
  });

  it('a Device reads the Usuals and cannot write them', async () => {
    const { account, phone } = await arrange();
    const tablet = await asDevice(account);
    tablets.push(tablet);
    await createUsual(phone, account.household.id, { name: 'Milk', product: 'Good & Gather 2% milk', target_link: '' });
    const [milk] = await loadUsuals(phone);

    expect(await loadUsuals(tablet.client)).toHaveLength(1);
    await expect(createUsual(tablet.client, account.household.id, { name: 'Eggs', product: 'Eggs', target_link: '' })).rejects.toMatchObject({ code: '42501' });
    // A change or a delete by a Device is quietly no rows: the policy hides them, and the Usual stays as it was.
    await updateUsual(tablet.client, milk!.id, { name: 'Milk', product: 'Changed by a Device', target_link: '' });
    await deleteUsual(tablet.client, milk!.id);
    expect(await loadUsuals(phone)).toMatchObject([{ product: 'Good & Gather 2% milk' }]);
  });

  it('a Household Account of another Household cannot add, change or delete this Household\'s Usuals', async () => {
    const { account, phone } = await arrange();
    await createUsual(phone, account.household.id, { name: 'Milk', product: 'Good & Gather 2% milk', target_link: '' });
    const [milk] = await loadUsuals(phone);
    const other = await createHousehold();
    households.push(other);
    const stranger = await asHouseholdAccount(other);

    await expect(createUsual(stranger, account.household.id, { name: 'Eggs', product: 'Eggs', target_link: '' })).rejects.toMatchObject({ code: '42501' });
    await updateUsual(stranger, milk!.id, { name: 'Milk', product: 'Changed by another Household', target_link: '' });
    await deleteUsual(stranger, milk!.id);
    expect(await loadUsuals(phone)).toMatchObject([{ product: 'Good & Gather 2% milk' }]);
  });

  it('another Household and an anonymous session see no Usuals', async () => {
    const { account, phone } = await arrange();
    await createUsual(phone, account.household.id, { name: 'Milk', product: 'Good & Gather 2% milk', target_link: '' });
    const other = await createHousehold();
    households.push(other);

    expect(await loadUsuals(await asHouseholdAccount(other))).toEqual([]);
    const { data, error } = await asAnonymous().from('usuals').select('id');
    expect(error ? [] : data).toEqual([]);
  });

  it('refuses a name the Household has, in any case or spacing, on a new Usual and on a change', async () => {
    const { account, phone } = await arrange();
    await createUsual(phone, account.household.id, { name: 'Milk', product: 'Good & Gather 2% milk', target_link: '' });
    await createUsual(phone, account.household.id, { name: 'Eggs', product: 'Large brown eggs', target_link: '' });
    const eggs = (await loadUsuals(phone)).find((usual) => usual.name === 'Eggs');

    await expect(createUsual(phone, account.household.id, { name: '  MILK   ', product: 'Oat milk', target_link: '' })).rejects.toMatchObject({ code: '23505' });
    await expect(updateUsual(phone, eggs!.id, { name: 'milk ', product: 'Large brown eggs', target_link: '' })).rejects.toMatchObject({ code: '23505' });
  });

  it('refuses a link that is not a Target product link', async () => {
    const { account, phone } = await arrange();
    await expect(
      createUsual(phone, account.household.id, { name: 'Eggs', product: 'Large brown eggs', target_link: 'https://example.com/p/eggs' }),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
