export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
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
