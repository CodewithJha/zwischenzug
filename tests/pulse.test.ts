import { describe, expect, it } from 'vitest';
import { computeBaseline, median } from '../src/core/pulse';

describe('median', () => {
  it('handles odd, even and empty inputs', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('computeBaseline', () => {
  it('uses the median, so one spike does not move the baseline', () => {
    const readings = [68, 70, 69, 71, 70, 140, 70, 69, 70, 71];
    expect(computeBaseline(readings, 10)).toEqual({ bpm: 70, samples: 10 });
  });

  it('requires enough plausible readings', () => {
    expect(computeBaseline([70, 71, 72], 10)).toBeNull();
    expect(computeBaseline([...Array(9).fill(70), 0, 500, Number.NaN], 10)).toBeNull();
  });
});
