import { describe, expect, it } from 'vitest';
import { steadyClock } from '../src/core/clock';
import { DEFAULT_CONFIG } from '../src/core/config';
import { INITIAL_STATE, cooldownRules, step } from '../src/core/cooldown';

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

  it('never goes backwards on resync (clock set back, then sleep/wake)', () => {
    let wall = 1_000_000_000;
    let mono = 0;
    const clock = steadyClock(
      () => wall,
      () => mono,
    );
    mono += 30_000;
    wall -= 86_400_000; // clock set back a day
    clock.resync();
    expect(clock.now()).toBe(1_000_030_000);
    mono += 5_000;
    expect(clock.now()).toBe(1_000_035_000);
  });

  it('a cooldown still ends by the hard maximum after the clock is set back during sleep', () => {
    let wall = 1_800_000_000_000;
    let mono = 0;
    const clock = steadyClock(
      () => wall,
      () => mono,
    );
    const rules = cooldownRules(DEFAULT_CONFIG);
    let state = step(
      INITIAL_STATE,
      { type: 'GAME_FINISHED', gameId: 'g', outcome: 'loss', baselineBpm: 70, at: clock.now() },
      rules,
    ).state;
    mono += 100_000;
    wall -= 86_400_000;
    clock.resync();
    mono += rules.maxMs - 100_000;
    state = step(state, { type: 'TICK', at: clock.now() }, rules).state;
    expect(state.phase).toBe('playing');
  });
});
