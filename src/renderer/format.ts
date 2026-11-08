/** Pure display formatting. No DOM, so it is unit-tested. */
import type { GameLogEntry } from '../shared/types';

const DAY_MS = 86_400_000;

/** Whole beats per minute, or an en dash when there is no value. */
export function formatBpm(bpm: number | null | undefined): string {
  return bpm == null || !Number.isFinite(bpm) ? '–' : String(Math.round(bpm));
}

/** Seconds as m:ss (negative values clamp to 0:00). */
export function formatSec(total: number): string {
  const sec = Math.max(0, Math.round(total));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

/** Wall-clock time, hours and minutes, e.g. "6:52 PM". */
export function formatClock(ms: number, locale?: string): string {
  // Newer ICU puts a narrow no-break space before AM/PM; keep output stable across runtimes.
  return new Date(ms)
    .toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
    .replace(/\u202f/g, ' ');
}

const startOfDay = (ms: number): number => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Short, relative date for logs: "Today, 6:52 PM", "Yesterday, 9:10 AM", "Nov 5, 6:52 PM". */
export function formatWhen(ms: number, now: number, locale?: string): string {
  const clock = formatClock(ms, locale);
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / DAY_MS);
  if (days === 0) return `Today, ${clock}`;
  if (days === 1) return `Yesterday, ${clock}`;
  const sameYear = new Date(ms).getFullYear() === new Date(now).getFullYear();
  const date = new Date(ms).toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  return `${date}, ${clock}`;
}

/** First letter upper-cased: "bullet" -> "Bullet". */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const UNLOCKED_BY = { biometric: 'Unlocked by pulse', timer: 'Unlocked by timer' } as const;

/** One line for a logged cooldown: "Unlocked by pulse after 1:00 · 74 bpm at the loss". */
export function describeCooldown(c: NonNullable<GameLogEntry['cooldown']>): string {
  const after = formatSec(c.timeToUnlockSec);
  const how =
    c.unlockReason === 'override'
      ? `Skipped after ${after}`
      : `${UNLOCKED_BY[c.unlockReason]} after ${after}`;
  return c.pulseAtLossBpm == null ? how : `${how} · ${formatBpm(c.pulseAtLossBpm)} bpm at the loss`;
}
