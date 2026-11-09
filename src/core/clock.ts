export interface SteadyClock {
  now(): number;
  /** Re-anchor to the wall clock, e.g. after the computer wakes from sleep. */
  resync(): void;
}

/**
 * Epoch milliseconds that advance with a monotonic timer, so changing the system clock
 * while the app runs neither ends nor extends a cooldown.
 */
export function steadyClock(wall: () => number, mono: () => number): SteadyClock {
  let wall0 = wall();
  let mono0 = mono();
  const now = (): number => wall0 + (mono() - mono0);
  return {
    now,
    // Never backwards: a clock set back during sleep must not push "now" before a cooldown
    // started, which would hold the lock past its maximum.
    resync: () => {
      wall0 = Math.max(wall(), now());
      mono0 = mono();
    },
  };
}
