export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

export interface ReadingStats {
  count: number;
  /** Seconds from start to the first reading, null before one arrived. */
  firstAfterSec: number | null;
  /** Readings per second since the first reading. */
  perSec: number | null;
  /** Share of stable readings, 0-1. */
  stableShare: number | null;
}

/** Diagnostics summary of a measurement session. Times are ms; `received` is ascending. */
export function readingStats(
  startedAt: number,
  received: readonly { at: number; stable: boolean }[],
  now: number,
): ReadingStats {
  const first = received[0];
  if (!first) return { count: 0, firstAfterSec: null, perSec: null, stableShare: null };
  const span = (now - first.at) / 1000;
  return {
    count: received.length,
    firstAfterSec: (first.at - startedAt) / 1000,
    perSec: span > 0 ? received.length / span : null,
    stableShare: received.filter((r) => r.stable).length / received.length,
  };
}

/**
 * Baseline from calibration: the median of stable readings in a plausible range.
 * Null when there are too few to trust (then the user retries or uses the timer).
 */
export function computeBaseline(
  stableBpms: readonly number[],
  minSamples: number,
): { bpm: number; samples: number } | null {
  const plausible = stableBpms.filter((b) => Number.isFinite(b) && b >= 35 && b <= 200);
  if (plausible.length < minSamples) return null;
  const bpm = median(plausible);
  return bpm === null ? null : { bpm: Math.round(bpm * 10) / 10, samples: plausible.length };
}
