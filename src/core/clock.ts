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
  return {
    now: () => wall0 + (mono() - mono0),
    resync: () => {
      wall0 = wall();
      mono0 = mono();
    },
  };
}
