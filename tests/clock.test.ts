import { describe, expect, it } from 'vitest';
import { steadyClock } from '../src/core/clock';

describe('steadyClock', () => {
  it('ignores system clock changes and follows the monotonic timer', () => {
    let wall = 1_000_000;
    let mono = 50;
    const clock = steadyClock(
      () => wall,
      () => mono,
    );
    mono += 10_000;
    wall += 10_000 + 3_600_000; // clock set an hour forward
    expect(clock.now()).toBe(1_010_000);
    wall -= 7_200_000; // and two hours back
    expect(clock.now()).toBe(1_010_000);
  });

  it('re-anchors to the wall clock on resync (time asleep counts)', () => {
    let wall = 1_000_000;
    const clock = steadyClock(
      () => wall,
      () => 0,
    );
    wall += 600_000;
    clock.resync();
    expect(clock.now()).toBe(1_600_000);
  });
});
