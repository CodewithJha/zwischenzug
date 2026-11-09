import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/core/config';
import {
  INITIAL_STATE,
  cooldownRules,
  cooldownView,
  step,
  unlockReason,
  upperBand,
  type EngineEvent,
  type EngineState,
  type Unlock,
} from '../src/core/cooldown';

const rules = cooldownRules(DEFAULT_CONFIG); // min 60s, sustain 15s, fallback 180s, max 900s, stale 5s
const T0 = 1_800_000_000_000;
const sec = (s: number): number => T0 + s * 1000;

function run(events: EngineEvent[], from: EngineState = INITIAL_STATE) {
  let state = from;
  const unlocks: Unlock[] = [];
  for (const e of events) {
    const r = step(state, e, rules);
    state = r.state;
    if (r.unlock) unlocks.push(r.unlock);
  }
  return { state, unlocks };
}

const loss = (at = T0, baselineBpm: number | null = 70, gameId = 'game0001'): EngineEvent => ({
  type: 'GAME_FINISHED',
  gameId,
  outcome: 'loss',
  baselineBpm,
  at,
});
const pulse = (s: number, bpm: number, stable = true): EngineEvent => ({
  type: 'PULSE',
  bpm,
  stable,
  at: sec(s),
});
const tick = (s: number): EngineEvent => ({ type: 'TICK', at: sec(s) });
/** One stable sample per second from `from` to `to` inclusive. */
const pulses = (from: number, to: number, bpm: number): EngineEvent[] =>
  Array.from({ length: to - from + 1 }, (_, i) => pulse(from + i, bpm));

describe('upperBand', () => {
  it('uses the larger of 5 bpm and 7%', () => {
    expect(upperBand(60, rules)).toBe(65); // 7% = 4.2 < 5
    expect(upperBand(100, rules)).toBeCloseTo(107); // 7% = 7 > 5
  });
});

describe('game results', () => {
  it('a loss starts a cooldown', () => {
    const { state } = run([loss()]);
    expect(state.phase).toBe('cooldown');
    expect(state.consecutiveLosses).toBe(1);
  });

  it('wins and draws do not lock and reset the streak', () => {
    const { state } = run([
      loss(),
      { type: 'OVERRIDE', at: sec(1) },
      { type: 'GAME_FINISHED', gameId: 'g2', outcome: 'draw', baselineBpm: 70, at: sec(100) },
    ]);
    expect(state).toEqual({ phase: 'playing', consecutiveLosses: 0 });
  });

  it('a win during a cooldown does not cancel it', () => {
    const { state } = run([
      loss(),
      { type: 'GAME_FINISHED', gameId: 'g2', outcome: 'win', baselineBpm: 70, at: sec(5) },
    ]);
    expect(state.phase).toBe('cooldown');
  });

  it('a loss during a cooldown counts but keeps the original cooldown', () => {
    const { state } = run([loss(), loss(sec(10), 70, 'game0002')]);
    expect(state.consecutiveLosses).toBe(2);
    if (state.phase !== 'cooldown') throw new Error('expected cooldown');
    expect(state.cooldown.gameId).toBe('game0001');
  });

  it('suggests a longer pause from the 5th loss in a row', () => {
    let state: EngineState = { phase: 'playing', consecutiveLosses: 3 };
    state = run([loss()], state).state;
    expect(state.phase === 'cooldown' && state.cooldown.suggestedPauseUntil).toBeNull();
    state = run([{ type: 'OVERRIDE', at: sec(1) }, loss(sec(2))], state).state;
    expect(state.consecutiveLosses).toBe(5);
    expect(state.phase === 'cooldown' && state.cooldown.suggestedPauseUntil).toBe(
      sec(2) + 30 * 60_000,
    );
  });
});

describe('biometric unlock', () => {
  it('unlocks once settled for 15s and the 60s minimum has passed', () => {
    const { state, unlocks } = run([loss(), ...pulses(1, 59, 72), tick(60)]);
    expect(state.phase).toBe('playing');
    expect(unlocks).toHaveLength(1);
    expect(unlocks[0]?.reason).toBe('biometric');
    expect(unlocks[0]?.at).toBe(sec(60));
  });

  it('never unlocks before the minimum wait, however calm', () => {
    const { state } = run([loss(), ...pulses(1, 59, 60)]);
    expect(state.phase).toBe('cooldown');
  });

  it('requires the settled streak to be sustained', () => {
    // Elevated until 70s, then settled: unlock at 70 + 15 = 85s, not earlier.
    const r1 = run([loss(), ...pulses(1, 69, 90), ...pulses(70, 84, 72)]);
    expect(r1.state.phase).toBe('cooldown');
    const r2 = run([loss(), ...pulses(1, 69, 90), ...pulses(70, 85, 72)]);
    expect(r2.unlocks[0]?.reason).toBe('biometric');
    expect(r2.unlocks[0]?.at).toBe(sec(85));
  });

  it('an elevated sample resets the streak', () => {
    const { state } = run([loss(), ...pulses(55, 65, 72), pulse(66, 80), ...pulses(67, 75, 72)]);
    expect(state.phase).toBe('cooldown');
    if (state.phase !== 'cooldown') throw new Error('expected cooldown');
    expect(state.cooldown.settledSince).toBe(sec(67));
  });

  it('ignores unstable (low-confidence) samples', () => {
    const { state } = run([loss(), ...pulses(1, 30, 72).map((e) => ({ ...e, stable: false }))]);
    if (state.phase !== 'cooldown') throw new Error('expected cooldown');
    expect(state.cooldown.lastValidAt).toBeNull();
    expect(state.cooldown.firstBpm).toBeNull();
  });

  it('a lost signal resets the streak', () => {
    const { state } = run([loss(), ...pulses(50, 58, 72), tick(64), ...pulses(65, 70, 72)]);
    if (state.phase !== 'cooldown') throw new Error('expected cooldown');
    expect(state.cooldown.settledSince).toBe(sec(65));
  });

  it('records the first stable reading as pulse at loss', () => {
    const { unlocks } = run([loss(), pulse(3, 88), ...pulses(4, 80, 72)]);
    expect(unlocks[0]?.cooldown.firstBpm).toBe(88);
  });

  it('rejects nonsense readings', () => {
    const { state } = run([loss(), pulse(1, Number.NaN), pulse(2, -4)]);
    if (state.phase !== 'cooldown') throw new Error('expected cooldown');
    expect(state.cooldown.lastValidAt).toBeNull();
  });
});

describe('timer fallback', () => {
  it('unlocks by timer after 180s with no usable signal', () => {
    expect(run([loss(), tick(179)]).state.phase).toBe('cooldown');
    const { unlocks } = run([loss(), tick(180)]);
    expect(unlocks[0]?.reason).toBe('timer');
  });

  it('does not use the timer while a fresh signal shows an elevated pulse', () => {
    const { state } = run([loss(), ...pulses(170, 200, 95)]);
    expect(state.phase).toBe('cooldown');
  });

  it('uses the timer once an elevated signal has been gone for the fallback time', () => {
    expect(run([loss(), ...pulses(170, 200, 95), tick(206)]).state.phase).toBe('cooldown');
    expect(run([loss(), ...pulses(170, 200, 95), tick(379)]).state.phase).toBe('cooldown');
    const { unlocks } = run([loss(), ...pulses(170, 200, 95), tick(380)]);
    expect(unlocks[0]?.reason).toBe('timer');
  });

  it('elevated pulse with intermittent gaps does not unlock early via a gap', () => {
    // 20 s of readings, then a 10 s gap (TICKs only), repeated.
    const events: EngineEvent[] = [loss()];
    for (let t = 0; t < 900; t += 30) {
      events.push(...pulses(t + 1, t + 20, 100));
      for (let g = t + 21; g <= t + 30; g++) events.push(tick(g));
    }
    const { unlocks } = run(events);
    expect(unlocks[0]?.at).toBe(sec(900)); // only the hard maximum
  });

  it('after a signal gap, returning readings bring the pulse rule back', () => {
    const gap = Array.from({ length: 70 }, (_, i) => tick(171 + i)); // 171..240 s
    const elevated = run([loss(), ...pulses(100, 170, 100), ...gap, ...pulses(241, 300, 100)]);
    expect(elevated.state.phase).toBe('cooldown');
    const settled = run([loss(), ...pulses(100, 170, 100), ...gap, ...pulses(241, 300, 72)]);
    expect(settled.unlocks[0]).toMatchObject({ reason: 'biometric', at: sec(256) });
  });

  it('the countdown shows when the timer would actually unlock', () => {
    const { state } = run([loss(), ...pulses(170, 200, 95), tick(210)]);
    if (state.phase !== 'cooldown') throw new Error('expected a cooldown');
    expect(cooldownView(state.cooldown, sec(210), rules).fallbackRemainingSec).toBe(170);
  });

  it('never holds longer than the hard maximum', () => {
    const { unlocks } = run([loss(), ...pulses(880, 900, 95)]);
    expect(unlocks[0]?.reason).toBe('timer');
    expect(unlocks[0]?.at).toBe(sec(900));
  });

  it('without a baseline (timer-only mode) only the timer can unlock', () => {
    const { state, unlocks } = run([loss(T0, null), ...pulses(1, 100, 60), tick(185)]);
    expect(state.phase).toBe('playing');
    expect(unlocks[0]?.reason).toBe('timer');
  });
});

describe('override and idle events', () => {
  it('override unlocks immediately', () => {
    const { unlocks } = run([loss(), { type: 'OVERRIDE', at: sec(2) }]);
    expect(unlocks[0]?.reason).toBe('override');
  });

  it('pulse, tick and override are no-ops while playing', () => {
    const { state, unlocks } = run([pulse(1, 70), tick(2), { type: 'OVERRIDE', at: sec(3) }]);
    expect(state).toEqual(INITIAL_STATE);
    expect(unlocks).toEqual([]);
  });
});

describe('unlockReason and cooldownView', () => {
  const base = {
    gameId: 'g',
    startedAt: T0,
    baselineBpm: 70,
    lastBpm: 72,
    lastValidAt: sec(100),
    settledSince: sec(90),
    firstBpm: 85,
    suggestedPauseUntil: null,
  };

  it('biometric needs a fresh signal at decision time', () => {
    expect(unlockReason(base, sec(105), rules)).toBe('biometric');
    expect(unlockReason(base, sec(106), rules)).toBeNull(); // stale, and before fallback
  });

  it('derives display values', () => {
    const v = cooldownView(base, sec(100), rules);
    expect(v).toMatchObject({
      upperBandBpm: 75,
      lastBpm: 72,
      signalFresh: true,
      settledForSec: 10,
      minWaitRemainingSec: 0,
      fallbackRemainingSec: 180, // counted from the last valid reading

      maxRemainingSec: 800,
    });
    expect(cooldownView(base, sec(110), rules)).toMatchObject({ lastBpm: null, settledForSec: 0 });
  });
});
