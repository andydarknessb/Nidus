// Which page a path is for, with nothing of the DOM in it so that it is tested without a screen. "/settings" is the phone's
// administration, "/join" is the page a Household Invite's link opens (whatever follows it: a path that is not a live link is
// that page's own dead-link state), and every other path is the Wall.
export type Page = 'settings' | 'join' | 'wall';

export function pageOf(pathname: string): Page {
  if (pathname === '/settings' || pathname.startsWith('/settings/')) return 'settings';
  if (pathname === '/join' || pathname.startsWith('/join/')) return 'join';
  return 'wall';
}
