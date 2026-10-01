import { Check } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { updateHouseholdWeather, type Household } from '@/lib/household';
import { describePlace, searchPlaces, type PlaceMatch, type TemperatureUnit } from '@/lib/weather';

const field = 'min-h-12 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground';
const action = 'min-h-12 rounded-lg px-4 text-base font-medium';
const choice =
  'flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border-2 border-border px-4 text-base font-medium has-[:checked]:border-foreground has-[:checked]:bg-muted has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-foreground';

const UNITS: { value: TemperatureUnit; label: string }[] = [
  { value: 'fahrenheit', label: 'Fahrenheit' },
  { value: 'celsius', label: 'Celsius' },
];

// The search and the save each say how they went, in words, beside the button that started them.
type SearchStatus = 'idle' | 'searching' | 'none' | 'failed';
type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed';

const SEARCH_WORDS: Record<SearchStatus, string> = {
  idle: '',
  searching: 'Searching',
  none: 'No places found.',
  failed: 'Could not search. Check your connection.',
};

const SAVE_WORDS: Record<SaveStatus, string> = {
  idle: '',
  saving: '',
  saved: 'Saved.',
  failed: 'Could not save. Try again.',
};

// Settings, phone only: where the Household's weather is for and which unit it shows in. The phone
// asks Open-Meteo for matches itself; a Device reads the saved place and never gets this screen.
export function WeatherSection({ household, onSaved }: { household: Household; onSaved: (household: Household) => void }) {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<PlaceMatch[]>([]);
  const [picked, setPicked] = useState<PlaceMatch | null>(null);
  const [unit, setUnit] = useState<TemperatureUnit>(household.temperature_unit);
  const [searchStatus, setSearchStatus] = useState<SearchStatus>('idle');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const searchBox = useRef<HTMLInputElement>(null);

  // The place already saved, in the shape a save takes, so a change of unit alone needs no new search.
  const saved =
    household.weather_place !== null && household.latitude !== null && household.longitude !== null
      ? { place: household.weather_place, latitude: household.latitude, longitude: household.longitude }
      : null;

  async function search(event: FormEvent) {
    event.preventDefault();
    const name = query.trim();
    if (name === '') return;
    setSearchStatus('searching');
    setSaveStatus('idle');
    // Matches from an earlier search are gone from the moment a new one starts.
    setMatches([]);
    setPicked(null);
    try {
      const found = await searchPlaces(name);
      setMatches(found);
      setSearchStatus(found.length === 0 ? 'none' : 'idle');
    } catch {
      setSearchStatus('failed');
    }
  }

  // Stores a place (or none, which turns the weather off) with the chosen unit.
  async function save(weather: { place: string; latitude: number; longitude: number } | null) {
    setSaveStatus('saving');
    try {
      onSaved(await updateHouseholdWeather(household.id, weather, unit));
      setMatches([]);
      setPicked(null);
      setQuery('');
      setSearchStatus('idle');
      setSaveStatus('saved');
      // Turning the weather off removes the button that was pressed: put focus on the search instead of losing it.
      if (weather === null) searchBox.current?.focus();
    } catch {
      setSaveStatus('failed');
    }
  }

  return (
    <section aria-labelledby="weather-heading" className="flex flex-col gap-4">
      <h2 id="weather-heading" className="text-xl font-semibold">
        Weather
      </h2>
      <p className="text-base">{household.weather_place === null ? 'Weather is off.' : `Weather for ${household.weather_place}`}</p>

      <form onSubmit={(event) => void search(event)} className="flex flex-col gap-4">
        <label className="flex flex-col gap-2 text-base">
          Town or city
          <input ref={searchBox} className={field} type="search" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={100} required />
        </label>
        <button type="submit" className={`${action} border border-border disabled:opacity-40`} disabled={searchStatus === 'searching'}>
          Search
        </button>
      </form>
      <p role="status" className="min-h-6 text-base">
        {SEARCH_WORDS[searchStatus]}
      </p>

      {matches.length > 0 && (
        <ul aria-label="Places found" className="flex flex-col gap-2">
          {matches.map((match, index) => (
            <li key={index}>
              <button
                type="button"
                aria-pressed={picked === match}
                className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg border-2 border-border px-4 py-2 text-left text-base font-medium aria-pressed:border-foreground aria-pressed:bg-muted"
                onClick={() => setPicked(match)}
              >
                {describePlace(match)}
                {picked === match && <Check aria-hidden="true" className="size-6 shrink-0" />}
              </button>
            </li>
          ))}
        </ul>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-base">Temperature unit</legend>
        <div className="flex flex-wrap gap-2">
          {UNITS.map(({ value, label }) => (
            <label key={value} className={choice}>
              <input type="radio" name="temperature-unit" className="size-6" value={value} checked={unit === value} onChange={() => setUnit(value)} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex gap-3">
        <button
          type="button"
          className={`${action} flex-1 bg-primary text-primary-foreground disabled:opacity-40`}
          disabled={saveStatus === 'saving'}
          onClick={() => void save(picked ? { place: describePlace(picked), latitude: picked.latitude, longitude: picked.longitude } : saved)}
        >
          Save
        </button>
        {saved && (
          <button type="button" className={`${action} border border-border disabled:opacity-40`} disabled={saveStatus === 'saving'} onClick={() => void save(null)}>
            Turn weather off
          </button>
        )}
      </div>
      <p role="status" className="min-h-6 text-base">
        {SAVE_WORDS[saveStatus]}
      </p>

      <a href="https://open-meteo.com/" target="_blank" rel="noreferrer" className="inline-flex min-h-12 items-center self-start text-base underline">
        Weather data by Open-Meteo.com
      </a>
    </section>
  );
}
