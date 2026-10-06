import { AdminApp } from './AdminApp';
import { JoinPage } from './JoinPage';
import { pageOf } from './lib/page-of';
import { WallPage } from './WallPage';

// "/" is the Wall, for a Device and for the Household Account. Administration lives at "/settings", Household Account only,
// and is reached from a phone. "/join/<token>" is where an invite link lands, signed in or not.
export function App() {
  const page = pageOf(window.location.pathname);
  return page === 'settings' ? <AdminApp /> : page === 'join' ? <JoinPage /> : <WallPage />;
}
