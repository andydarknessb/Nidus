import type { WallNavigator, WallRoute } from './lib/wall-routes';
import type { HouseholdView } from './lib/household';
import type { Profile } from './lib/profiles';
import type { RoutineChart } from './lib/routine-chart';
import type { Forecast } from './lib/weather';
import { PhoneCalendar } from './phone/PhoneCalendar';
import { PhoneHome } from './phone/PhoneHome';
import { PhoneLists } from './phone/PhoneLists';
import { PhoneMeals } from './phone/PhoneMeals';
import { PhoneRoutines } from './phone/PhoneRoutines';

// The screen in the phone's column, chosen by the route (docs/specs/0004-the-wall-on-a-phone.md). HomeShell reads everything once and
// hands it down, so a phone screen reads nothing of its own that the tablet's does not: no reader, query or subscription is added here.
// Each route is one branch below, a screen under src/phone/ that takes these same props.

export type PhoneScreenProps = {
  route: WallRoute;
  // The Household Timezone; null until the Household is read.
  timezone: string | null;
  // The Household read, for a screen's "could not load" words.
  view: HouseholdView;
  forecast: Forecast | null;
  weatherOn: boolean;
  // The Household's Profiles; null until read.
  profiles: Profile[] | null;
  // Today's Routines, read once by HomeShell.
  routines: RoutineChart;
  // Every way the phone's chrome moves to another screen; a screen takes the same navigator.
  navigator: WallNavigator;
};

export function PhoneWall(props: PhoneScreenProps) {
  const { route } = props;
  switch (route.view) {
    case 'home': return <PhoneHome {...props} />;
    case 'day':
    case 'week':
    case 'month':
      return <PhoneCalendar {...props} route={route} />;
    case 'routines': return <PhoneRoutines {...props} />;
    case 'meals': return <PhoneMeals {...props} route={route} />;
    case 'lists': return <PhoneLists />;
  }
}
