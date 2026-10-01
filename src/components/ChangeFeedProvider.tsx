import { useEffect, useState, type ReactNode } from 'react';
import { ChangeFeedContext } from '../lib/change-feed';
import { openChangeFeed, type ChangeFeed } from '../lib/realtime';
import { supabase } from '../lib/supabase';

// Opens the Realtime change feed for the screens under it. Mount it once a session exists: the
// feed listens as whoever is signed in (a Household Account or a Device).
export function ChangeFeedProvider({ children }: { children: ReactNode }) {
  const [feed, setFeed] = useState<ChangeFeed | null>(null);
  useEffect(() => {
    const opened = openChangeFeed(supabase);
    setFeed(opened);
    return () => opened.close();
  }, []);
  return <ChangeFeedContext.Provider value={feed}>{children}</ChangeFeedContext.Provider>;
}
