import { AdminApp } from './AdminApp';
import { WallPage } from './WallPage';

// The tablet opens "/" and only ever sees the wall. Administration lives at
// "/settings" and is reached from a phone.
function isAdminPath(pathname: string): boolean {
  return pathname === '/settings' || pathname.startsWith('/settings/');
}

export function App() {
  return isAdminPath(window.location.pathname) ? <AdminApp /> : <WallPage />;
}
