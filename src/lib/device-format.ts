// Display helpers for Devices. Pure, so they carry no Supabase client.

// "9:41" for the Pairing Code countdown; never negative.
export function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// How long ago a Device was last seen, in words a parent can scan.
export function lastSeenLabel(lastSeenAt: string | null, now: Date): string {
  if (!lastSeenAt) return 'Not seen yet';
  const seconds = Math.max(0, Math.floor((now.getTime() - new Date(lastSeenAt).getTime()) / 1000));
  if (seconds < 90) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  return `${Math.floor(hours / 24)} days ago`;
}
