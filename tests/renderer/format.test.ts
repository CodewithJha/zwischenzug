import { describe, expect, it } from 'vitest';
import {
  capitalize,
  formatBpm,
  formatClock,
  formatSec,
  formatWhen,
} from '../../src/renderer/format';

describe('formatBpm', () => {
  it('rounds to whole beats', () => {
    expect(formatBpm(74.09070587158203)).toBe('74');
    expect(formatBpm(77.5)).toBe('78');
  });

  it('shows an en dash without a value', () => {
    expect(formatBpm(null)).toBe('–');
    expect(formatBpm(undefined)).toBe('–');
    expect(formatBpm(Number.NaN)).toBe('–');
  });
});

describe('formatSec', () => {
  it('formats m:ss', () => {
    expect(formatSec(0)).toBe('0:00');
    expect(formatSec(9)).toBe('0:09');
    expect(formatSec(123)).toBe('2:03');
    expect(formatSec(826)).toBe('13:46');
  });

  it('clamps negatives and rounds fractions', () => {
    expect(formatSec(-5)).toBe('0:00');
    expect(formatSec(59.6)).toBe('1:00');
  });
});

describe('formatWhen', () => {
  const now = new Date(2026, 10, 8, 13, 5).getTime();

  it('uses Today and Yesterday', () => {
    expect(formatWhen(new Date(2026, 10, 8, 9, 4).getTime(), now, 'en-US')).toBe('Today, 9:04 AM');
    expect(formatWhen(new Date(2026, 10, 7, 18, 52).getTime(), now, 'en-US')).toBe(
      'Yesterday, 6:52 PM',
    );
  });

  it('uses a short date for older games, with the year only when it differs', () => {
    expect(formatWhen(new Date(2026, 10, 5, 18, 52).getTime(), now, 'en-US')).toBe(
      'Nov 5, 6:52 PM',
    );
    expect(formatWhen(new Date(2025, 11, 31, 23, 0).getTime(), now, 'en-US')).toBe(
      'Dec 31, 2025, 11:00 PM',
    );
  });

  it('formats clock times without seconds', () => {
    expect(formatClock(new Date(2026, 10, 8, 18, 52, 2).getTime(), 'en-US')).toBe('6:52 PM');
  });
});

describe('capitalize', () => {
  it('upper-cases the first letter', () => {
    expect(capitalize('bullet')).toBe('Bullet');
    expect(capitalize('')).toBe('');
  });
});
