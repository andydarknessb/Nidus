import { describe, expect, it } from 'vitest';
import type { Household } from '../src/lib/household';
import { changesOf, shownOf } from '../src/lib/household-draft';

// The Settings form is a draft over the Household as it is now (spec 0020, ticket 2): a field shows the Household's value until it is
// edited, and a Save sends only the fields edited. Pure, so the rule is tested without a screen.

const household: Household = {
  id: 'h1',
  name: 'The Andersons',
  timezone: 'America/Chicago',
  weather_place: null,
  latitude: null,
  longitude: null,
  temperature_unit: 'fahrenheit',
  appearance: 'auto',
};

describe('what the Household form shows', () => {
  it('shows the Household as it is until a field is edited', () => {
    expect(shownOf(household, {})).toEqual({ name: 'The Andersons', timezone: 'America/Chicago' });
  });

  it('shows the edit in its own field, and the Household in the other', () => {
    expect(shownOf(household, { name: 'The Nguyens' })).toEqual({ name: 'The Nguyens', timezone: 'America/Chicago' });
    expect(shownOf(household, { timezone: 'America/New_York' })).toEqual({ name: 'The Andersons', timezone: 'America/New_York' });
  });

  it('follows the Household in a field not edited, when another phone changes it', () => {
    const changed = { ...household, timezone: 'America/Los_Angeles' };
    expect(shownOf(changed, { name: 'The Nguyens' })).toEqual({ name: 'The Nguyens', timezone: 'America/Los_Angeles' });
  });

  it('keeps an edit when another phone changes that field meanwhile', () => {
    const renamed = { ...household, name: 'The Smiths' };
    expect(shownOf(renamed, { name: 'The Nguyens' }).name).toBe('The Nguyens');
  });
});

describe('what a Save sends', () => {
  it('sends nothing when nothing was edited, so nothing is written', () => {
    expect(changesOf({})).toBeNull();
  });

  it('sends the name alone when only the name was edited, and never the time zone', () => {
    expect(changesOf({ name: 'The Nguyens' })).toEqual({ name: 'The Nguyens' });
  });

  it('sends the time zone alone when only it was edited', () => {
    expect(changesOf({ timezone: 'America/New_York' })).toEqual({ timezone: 'America/New_York' });
  });

  it('sends both when both were edited, with the name trimmed', () => {
    expect(changesOf({ name: '  The Nguyens ', timezone: 'America/New_York' })).toEqual({ name: 'The Nguyens', timezone: 'America/New_York' });
  });

  it('sends a blank name as blank, so the database refuses it and the form says so', () => {
    expect(changesOf({ name: '   ' })).toEqual({ name: '' });
  });
});
