import { Cloud } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { Card, Field, labelClass } from '@/components/phone';
import { Button } from '@/components/ui/button';
import { updateHouseholdWeather, type Household } from '@/lib/household';
import { describePlaces, searchPlaces, type PlaceMatch, type TemperatureUnit, type WeatherPlace } from '@/lib/weather';

const UNITS: { value: TemperatureUnit; label: string }[] = [
  { value: 'fahrenheit', label: 'Fahrenheit' },
  { value: 'celsius', label: 'Celsius' },
];

// The search says how it went, in words, under the button that started it.
type SearchStatus = 'idle' | 'searching' | 'found' | 'none' | 'failed';
// What the last save did: nothing yet (or the next one has started), it landed, or it did not.
type SaveStatus = 'idle' | 'saved' | 'failed';

// What a search found is said by its count, so a screen reader hears that the list is there. A tap on a place uses it.
const foundWords = (count: number) => `${count} ${count === 1 ? 'place' : 'places'} found. Tap one to use it.`;

const SEARCH_WORDS: Record<Exclude<SearchStatus, 'found'>, string> = {
  idle: '',
  searching: 'Searching',
  none: 'No places found.',
  failed: 'Could not search. Check your connection.',
};

// Settings, phone only: where the Household's weather is for and which unit it shows in. The place is shown with a button to
// change it, which opens a search; a tap on a place found uses it, and a tap on a unit uses that, each saved at once as the
// Appearance is. The phone asks Open-Meteo for matches itself; a Device reads the saved place and never gets this screen.
export function WeatherSection({ household, onSaved }: { household: Household; onSaved: (household: Household) => void }) {
  const [changing, setChanging] = useState(false);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<PlaceMatch[]>([]);
  const [searchStatus, setSearchStatus] = useState<SearchStatus>('idle');
  // The unit being saved shows as chosen at once; it goes back to the saved one if the save fails.
  const [savingUnit, setSavingUnit] = useState<TemperatureUnit | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const changeButton = useRef<HTMLButtonElement>(null);

  const options = describePlaces(matches);
  const unit = savingUnit ?? household.temperature_unit;

  // The place already saved, in the same shape a save takes, so a change of unit alone needs no new search.
  const saved: WeatherPlace | null =
    household.weather_place !== null && household.latitude !== null && household.longitude !== null
      ? { place: household.weather_place, latitude: household.latitude, longitude: household.longitude }
      : null;

  function close() {
    setChanging(false);
    setQuery('');
    setMatches([]);
    setSearchStatus('idle');
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    const name = query.trim();
    if (name === '') return;
    setSearchStatus('searching');
    // Matches from an earlier search are gone from the moment a new one starts.
    setMatches([]);
    try {
      const found = await searchPlaces(name);
      setMatches(found);
      setSearchStatus(found.length === 0 ? 'none' : 'found');
    } catch {
      setSearchStatus('failed');
    }
  }

  // Writes a place (or none, which turns the weather off) with a unit; true once it is saved. One save at a time, so a slow
  // answer can never land after a newer one.
  async function save(weather: WeatherPlace | null, nextUnit: TemperatureUnit): Promise<boolean> {
    if (saving) return false;
    setSaving(true);
    setSaveStatus('idle');
    try {
      onSaved(await updateHouseholdWeather(household.id, weather, nextUnit));
      setSaveStatus('saved');
      return true;
    } catch {
      setSaveStatus('failed');
      return false;
    } finally {
      setSaving(false);
    }
  }

  // A place that is saved closes the search and puts the focus back on the button that opened it: the button just
  // pressed goes with the list.
  async function usePlace(weather: WeatherPlace | null) {
    if (await save(weather, unit)) {
      close();
      changeButton.current?.focus();
    }
  }

  async function chooseUnit(next: TemperatureUnit) {
    if (saving || next === household.temperature_unit) return;
    setSavingUnit(next);
    await save(saved, next);
    setSavingUnit(null);
  }

  return (
    <Card title="Weather">
      <div className="flex min-h-14 items-center gap-3 rounded-2xl bg-muted py-1 pr-1 pl-3.5">
        <Cloud aria-hidden className="size-[22px] shrink-0" />
        <p className="line-clamp-2 min-w-0 flex-1 text-[17px] leading-[22px] font-medium">{household.weather_place ?? 'Weather is off'}</p>
        <Button
          ref={changeButton}
          variant="quiet"
          aria-expanded={changing}
          {...(changing ? {} : { 'aria-label': saved ? 'Change weather place' : 'Choose a weather place' })}
          className="h-12 rounded-xl px-3.5 text-[15px] font-medium"
          onClick={() => (changing ? close() : setChanging(true))}
        >
          {changing ? 'Cancel' : saved ? 'Change' : 'Choose'}
        </Button>
      </div>

      {changing && (
        <div className="flex flex-col gap-4">
          <form onSubmit={(event) => void search(event)} className="flex flex-col gap-4">
            <Field label="Town or city">
              <input className="h-14 w-full text-[17px]" enterKeyHint="search" autoComplete="off" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} maxLength={100} required />
            </Field>
            <Button type="submit" variant="secondary" size="phone" disabled={searchStatus === 'searching' || saving}>
              Search
            </Button>
          </form>
          <p role="status" className="min-h-6 text-base">
            {searchStatus === 'found' ? foundWords(options.length) : SEARCH_WORDS[searchStatus]}
          </p>
          {options.length > 0 && (
            <ul aria-label="Places found" className="flex flex-col gap-2">
              {options.map((option, index) => (
                <li key={index}>
                  <Button variant="secondary" className="h-auto min-h-14 w-full justify-start py-2 text-left font-medium whitespace-normal" disabled={saving} onClick={() => void usePlace(option)}>
                    {option.place}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {saved && (
            <Button variant="quiet" size="phone" disabled={saving} onClick={() => void usePlace(null)}>
              Turn weather off
            </Button>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <span id="units-label" className={labelClass}>
          Show temperatures in
        </span>
        <div role="group" aria-labelledby="units-label" className="grid h-14 grid-cols-2 gap-2 rounded-2xl bg-muted p-1">
          {UNITS.map(({ value, label }) => (
            <Button key={value} variant="quiet" aria-pressed={unit === value} className="h-12 rounded-xl px-2 text-base font-medium" onClick={() => void chooseUnit(value)}>
              {label}
            </Button>
          ))}
        </div>
        {/* The status line is there from the start, so a screen reader has it before it speaks, and is one line tall whichever of
            the two says something, so nothing below moves. */}
        <div className="min-h-6 text-base">
          <p role="status">{saveStatus === 'saved' && 'Saved.'}</p>
          {saveStatus === 'failed' && <p role="alert">Could not save. Try again.</p>}
        </div>
      </div>

      <a href="https://open-meteo.com/" target="_blank" rel="noreferrer" className="inline-flex min-h-12 items-center self-start text-sm leading-5 text-muted-foreground underline">
        Weather data by Open-Meteo.com
      </a>
    </Card>
  );
}
