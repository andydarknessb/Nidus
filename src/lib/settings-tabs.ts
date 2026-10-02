// The phone's pages (spec 0003, Phone settings): a tab for each, the address each one lives at, and which page a path is for. Pure,
// so the tabs and the old address are tested without a screen.

export type SettingsTab = 'household' | 'calendars' | 'routines' | 'lists';

// In the order the tabs are drawn.
export const SETTINGS_TABS: readonly { tab: SettingsTab; path: string; label: string }[] = [
  { tab: 'household', path: '/settings', label: 'Household' },
  { tab: 'calendars', path: '/settings/calendars', label: 'Calendars' },
  { tab: 'routines', path: '/settings/routines', label: 'Routines' },
  { tab: 'lists', path: '/settings/lists', label: 'Lists' },
];

// The events added on the Wall were at /settings/events until the Calendars page took them in; that address now means
// /settings/calendars, and the address bar says so. Any other path is left as it is.
export function settingsPathNow(pathname: string): string {
  return pathname.replace(/^\/settings\/events(?=\/|$)/, '/settings/calendars');
}

// What a page is called, in its tab and in the document's title.
export function settingsLabelOf(tab: SettingsTab): string {
  return SETTINGS_TABS.find((entry) => entry.tab === tab)?.label ?? 'Household';
}

// The page a path under /settings is for. Anything it does not know is Household, as it always has been.
export function settingsTabOf(pathname: string): SettingsTab {
  const page = settingsPathNow(pathname).split('/')[2];
  return SETTINGS_TABS.find(({ tab, path }) => tab !== 'household' && path === `/settings/${page}`)?.tab ?? 'household';
}
