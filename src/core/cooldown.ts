import type { CooldownView, Outcome, UnlockReason } from '../shared/types';
import type { Config } from './config';

/** Engine thresholds in milliseconds. Built from Config by `cooldownRules`. */
export interface CooldownRules {
  minWaitMs: number;
  toleranceBpm: number;
  tolerancePct: number;
  sustainMs: number;
  fallbackMs: number;
  maxMs: number;
  signalTimeoutMs: number;
  escalateAfterLosses: number;
  suggestedPauseMs: number;
}

export interface Cooldown {
  gameId: string;
  startedAt: number;
  baselineBpm: number | null;
  lastBpm: number | null;
  lastValidAt: number | null;
  settledSince: number | null;
  /** First stable reading after the loss ("pulse at loss"). */
  firstBpm: number | null;
  suggestedPauseUntil: number | null;
}

export type EngineState =
  | { phase: 'playing'; consecutiveLosses: number }
  | { phase: 'cooldown'; consecutiveLosses: number; cooldown: Cooldown };

export type EngineEvent =
  | {
      type: 'GAME_FINISHED';
      gameId: string;
      outcome: Outcome;
      baselineBpm: number | null;
      at: number;
    }
  | { type: 'PULSE'; bpm: number; stable: boolean; at: number }
  | { type: 'TICK'; at: number }
  | { type: 'OVERRIDE'; at: number };

export interface Unlock {
  cooldown: Cooldown;
  reason: UnlockReason;
  at: number;
}

export const INITIAL_STATE: EngineState = { phase: 'playing', consecutiveLosses: 0 };

export function cooldownRules({ cooldown: c }: Config): CooldownRules {
  return {
    minWaitMs: c.minWaitSec * 1000,
    toleranceBpm: c.toleranceBpm,
    tolerancePct: c.tolerancePct,
    sustainMs: c.sustainSec * 1000,
    fallbackMs: c.fallbackSec * 1000,
    maxMs: c.maxSec * 1000,
    signalTimeoutMs: c.signalTimeoutSec * 1000,
    escalateAfterLosses: c.escalateAfterLosses,
    suggestedPauseMs: c.suggestedPauseMin * 60_000,
  };
}

export function upperBand(baselineBpm: number, rules: CooldownRules): number {
  return baselineBpm + Math.max(rules.toleranceBpm, (baselineBpm * rules.tolerancePct) / 100);
}

export function signalFresh(c: Cooldown, now: number, rules: CooldownRules): boolean {
  return c.lastValidAt !== null && now - c.lastValidAt <= rules.signalTimeoutMs;
}

/**
 * The unlock rule. Biometric: settled (with a fresh signal) for `sustainMs` and past the
 * minimum wait. Timer: no usable signal and past the fallback time, or past the hard maximum.
 */
export function unlockReason(c: Cooldown, now: number, rules: CooldownRules): UnlockReason | null {
  const elapsed = now - c.startedAt;
  if (elapsed < rules.minWaitMs) return null;
  const fresh = signalFresh(c, now, rules);
  if (c.baselineBpm !== null && fresh && c.settledSince !== null) {
    if (now - c.settledSince >= rules.sustainMs) return 'biometric';
  }
  if (!fresh && elapsed >= rules.fallbackMs) return 'timer';
  if (elapsed >= rules.maxMs) return 'timer';
  return null;
}

const secs = (ms: number): number => Math.max(0, Math.ceil(ms / 1000));

/** What the cooldown screen shows. Derived, never stored. */
export function cooldownView(c: Cooldown, now: number, rules: CooldownRules): CooldownView {
  const elapsed = now - c.startedAt;
  const fresh = signalFresh(c, now, rules);
  return {
    gameId: c.gameId,
    baselineBpm: c.baselineBpm,
    upperBandBpm: c.baselineBpm === null ? null : Math.round(upperBand(c.baselineBpm, rules)),
    lastBpm: fresh ? c.lastBpm : null,
    signalFresh: fresh,
    settledForSec: fresh && c.settledSince !== null ? Math.floor((now - c.settledSince) / 1000) : 0,
    sustainSec: rules.sustainMs / 1000,
    minWaitRemainingSec: secs(rules.minWaitMs - elapsed),
    fallbackRemainingSec: secs(rules.fallbackMs - elapsed),
    maxRemainingSec: secs(rules.maxMs - elapsed),
    suggestedPauseUntil: c.suggestedPauseUntil,
  };
}

function startCooldown(
  e: Extract<EngineEvent, { type: 'GAME_FINISHED' }>,
  losses: number,
  rules: CooldownRules,
): Cooldown {
  return {
    gameId: e.gameId,
    startedAt: e.at,
    baselineBpm: e.baselineBpm,
    lastBpm: null,
    lastValidAt: null,
    settledSince: null,
    firstBpm: null,
    suggestedPauseUntil: losses >= rules.escalateAfterLosses ? e.at + rules.suggestedPauseMs : null,
  };
}

function onPulse(c: Cooldown, bpm: number, at: number, rules: CooldownRules): Cooldown {
  const inBand = c.baselineBpm !== null && bpm <= upperBand(c.baselineBpm, rules);
  return {
    ...c,
    lastBpm: bpm,
    lastValidAt: at,
    firstBpm: c.firstBpm ?? bpm,
    settledSince: inBand ? (c.settledSince ?? at) : null,
  };
}

/** Pure state transition. Returns the next state and, if the lock just opened, why. */
export function step(
  state: EngineState,
  event: EngineEvent,
  rules: CooldownRules,
): { state: EngineState; unlock: Unlock | null } {
  if (event.type === 'GAME_FINISHED') {
    if (event.outcome !== 'loss') {
      // A win/draw resets the streak; it never cancels an active cooldown.
      return { state: { ...state, consecutiveLosses: 0 }, unlock: null };
    }
    const losses = state.consecutiveLosses + 1;
    if (state.phase === 'cooldown') {
      return { state: { ...state, consecutiveLosses: losses }, unlock: null };
    }
    const cooldown = startCooldown(event, losses, rules);
    return { state: { phase: 'cooldown', consecutiveLosses: losses, cooldown }, unlock: null };
  }

  if (state.phase !== 'cooldown') return { state, unlock: null };
  let c = state.cooldown;

  if (event.type === 'OVERRIDE') {
    return {
      state: { phase: 'playing', consecutiveLosses: state.consecutiveLosses },
      unlock: { cooldown: c, reason: 'override', at: event.at },
    };
  }

  if (event.type === 'PULSE') {
    // Unstable (low-confidence) samples neither count as settled nor break the streak;
    // if only unstable samples arrive, the signal goes stale and the streak resets on TICK.
    if (event.stable && Number.isFinite(event.bpm) && event.bpm > 0) {
      c = onPulse(c, event.bpm, event.at, rules);
    }
  } else if (!signalFresh(c, event.at, rules) && c.settledSince !== null) {
    c = { ...c, settledSince: null };
  }

  const reason = unlockReason(c, event.at, rules);
  if (reason) {
    return {
      state: { phase: 'playing', consecutiveLosses: state.consecutiveLosses },
      unlock: { cooldown: c, reason, at: event.at },
    };
  }
  return { state: { ...state, cooldown: c }, unlock: null };
}
