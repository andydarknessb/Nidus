import { AdminApp } from './AdminApp';
import { WallPage } from './WallPage';

// "/" is the Wall, for a Device and for the Household Account. Administration lives at
// "/settings", Household Account only, and is reached from a phone.
function isAdminPath(pathname: string): boolean {
  return pathname === '/settings' || pathname.startsWith('/settings/');
}

export function App() {
  return isAdminPath(window.location.pathname) ? <AdminApp /> : <WallPage />;
}
