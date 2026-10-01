-- Weather on the Wall (issue #58). The Household says where it lives, once, and the Wall asks
-- Open-Meteo for that place's forecast itself (no key, no server hop). Only the place and the
-- unit it is shown in are stored; nothing of the forecast is. So this adds four columns to
-- households and nothing else.
--
-- The Household Account writes them from the phone's settings; a Device (the wall) reads them.
-- No grant or policy changes are needed: `authenticated` already holds table-level select and
-- update on households, and its update policy already requires is_household_account(), so a
-- Device reads these columns and cannot change them, and another Household's principals can
-- neither read nor change them. Additive: a Household inserted without them has no place and
-- shows Fahrenheit, so nothing that inserts Households today has to change.

alter table public.households
  add column weather_place text
    check (weather_place is null or (char_length(weather_place) between 1 and 100 and weather_place ~ '\S')),
  -- Two decimals is about a kilometre, all a forecast needs and no more of the Household's
  -- whereabouts than that. The column type rounds whatever is written, so no client has to.
  add column latitude numeric(4,2) check (latitude between -90 and 90),
  add column longitude numeric(5,2) check (longitude between -180 and 180),
  add column temperature_unit text not null default 'fahrenheit' check (temperature_unit in ('fahrenheit', 'celsius')),
  -- A place is its name and both coordinates, or none of the three: never a name the wall
  -- cannot find, or a point it cannot call anything.
  add constraint households_weather_all_or_none check (num_nulls(weather_place, latitude, longitude) in (0, 3));

comment on column public.households.weather_place is 'The place the weather is for, as the picker worded it ("Austin, Texas, United States"). Null with latitude and longitude: the weather is off.';
comment on column public.households.latitude is 'Degrees north of the equator, rounded by the column to two decimals (about a kilometre). Null with weather_place and longitude.';
comment on column public.households.longitude is 'Degrees east of the prime meridian, rounded by the column to two decimals (about a kilometre). Null with weather_place and latitude.';
comment on column public.households.temperature_unit is 'The unit the wall shows temperatures in: fahrenheit or celsius.';
