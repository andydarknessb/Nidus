import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudMoon, CloudRain, CloudSnow, CloudSun, Moon, Sun, type LucideIcon } from 'lucide-react';
import { describeWeather, forecastDay, type Forecast, type ForecastDay, type TemperatureUnit, type WeatherIcon } from '../lib/weather';

// Weather on the Wall (issue #58): the two small pieces that show a forecast, one for the header and
// one for a day's heading. lib/use-forecast.ts reads the forecast they take. The condition in words
// is for a screen reader only, in each piece's accessible name: there is no room to draw it, and the
// icon is never the only cue.

// One picture for each condition.
const GLYPHS: Record<WeatherIcon, LucideIcon> = {
  sun: Sun,
  moon: Moon,
  'cloud-sun': CloudSun,
  'cloud-moon': CloudMoon,
  cloud: Cloud,
  fog: CloudFog,
  drizzle: CloudDrizzle,
  rain: CloudRain,
  snow: CloudSnow,
  thunderstorm: CloudLightning,
};

function Glyph({ icon, className }: { icon: WeatherIcon; className: string }) {
  const Picture = GLYPHS[icon];
  return <Picture aria-hidden="true" className={className} />;
}

// The header's reading: the icon, the temperature now and today's high and low. Today (a Household
// date) is found by its date, so a forecast gone stale across midnight never offers yesterday's range
// as today's. With no current reading (it was read too long ago, see forecastToShow) only the high
// and low show, and with nothing to show at all, nothing. A screen reader hears one phrase, with the
// condition in words, rather than a picture and bare numbers. It is kept compact (the icon, the
// temperature, and the high and low stacked small) and never shrinks, because the header also has to
// hold the Household's name, the clock and date and the badges.
export function WeatherNow({ forecast, unit, today }: { forecast: Forecast | null; unit: TemperatureUnit; today: string }) {
  const day = forecastDay(forecast, today);
  const reading = forecast?.current ? { ...describeWeather(forecast.current.code, forecast.current.isDay), temperature: forecast.current.temperature } : null;
  if (!reading && !day) return null;
  const heard = [
    reading && `${reading.words}, ${reading.temperature} degrees ${unit === 'celsius' ? 'Celsius' : 'Fahrenheit'}`,
    day && `high ${day.high}, low ${day.low}`,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <div role="img" aria-label={heard} className="flex shrink-0 items-center gap-2.5 whitespace-nowrap">
      {reading && (
        <>
          <Glyph icon={reading.icon} className="size-[30px] shrink-0" />
          <span className="font-display text-[32px] leading-9">{reading.temperature}°</span>
        </>
      )}
      {day && (
        <span className="flex flex-col text-sm leading-[18px] text-muted-foreground">
          <span>High {day.high}°</span>
          <span>Low {day.low}°</span>
        </span>
      )}
    </div>
  );
}

// A day's weather: the icon, then the high and the low on one compact line, in secondary words at 14 px, the smallest
// size. Nothing for a date the forecast does not cover, so a heading can pass whatever forecastDay found.
export function DayWeather({ day }: { day: ForecastDay | undefined }) {
  if (!day) return null;
  const { words, icon } = describeWeather(day.code);
  return (
    <span role="img" aria-label={`${words}, high ${day.high}, low ${day.low}`} className="inline-flex items-center gap-1 text-sm leading-[18px] font-normal text-muted-foreground">
      <Glyph icon={icon} className="size-[15px] shrink-0" />
      <span>
        {day.high}° / {day.low}°
      </span>
    </span>
  );
}
