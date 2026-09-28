import { describe, expect, it } from 'vitest';
import { formatCountdown, lastSeenLabel } from '../src/lib/device-format';

describe('formatCountdown', () => {
  it('shows minutes and zero-padded seconds', () => {
    expect(formatCountdown(10 * 60_000)).toBe('10:00');
    expect(formatCountdown(9 * 60_000 + 41_000)).toBe('9:41');
    expect(formatCountdown(5_000)).toBe('0:05');
  });

  it('rounds a partial second up and never goes negative', () => {
    expect(formatCountdown(4_200)).toBe('0:05');
    expect(formatCountdown(-3_000)).toBe('0:00');
  });
});

describe('lastSeenLabel', () => {
  const now = new Date('2026-09-28T12:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it('says so when a Device has never been seen', () => {
    expect(lastSeenLabel(null, now)).toBe('Not seen yet');
  });

  it('reads recent, minute, hour and day ages', () => {
    expect(lastSeenLabel(ago(30_000), now)).toBe('Just now');
    expect(lastSeenLabel(ago(5 * 60_000), now)).toBe('5 minutes ago');
    expect(lastSeenLabel(ago(60 * 60_000), now)).toBe('1 hour ago');
    expect(lastSeenLabel(ago(5 * 3_600_000), now)).toBe('5 hours ago');
    expect(lastSeenLabel(ago(72 * 3_600_000), now)).toBe('3 days ago');
  });
});
