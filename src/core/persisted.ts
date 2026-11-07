import type { CameraMode, GameLogEntry, Profile } from '../shared/types';
import { INITIAL_STATE, type Cooldown, type EngineState } from './cooldown';

export interface PersistedState {
  version: 1;
  profile: Profile;
  engine: EngineState;
}

export interface PersistedLog {
  version: 1;
  games: GameLogEntry[];
}

export const EMPTY_PROFILE: Profile = { consent: null, username: null, baseline: null };

export function freshState(): PersistedState {
  return { version: 1, profile: { ...EMPTY_PROFILE }, engine: INITIAL_STATE };
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const numOrNull = (v: unknown): number | null => (isNum(v) ? v : null);
const isMode = (v: unknown): v is CameraMode => v === 'camera' || v === 'timer-only';

function parseProfile(raw: unknown): Profile {
  if (!isRec(raw)) return { ...EMPTY_PROFILE };
  const c = raw.consent;
  const consent = isRec(c) && isNum(c.at) && isMode(c.mode) ? { at: c.at, mode: c.mode } : null;
  const b = raw.baseline;
  const baseline =
    isRec(b) && isNum(b.bpm) && isNum(b.at) && isNum(b.samples)
      ? { bpm: b.bpm, at: b.at, samples: b.samples }
      : null;
  const username = typeof raw.username === 'string' && raw.username ? raw.username : null;
  return { consent, username, baseline };
}

function parseCooldown(raw: unknown): Cooldown | null {
  if (!isRec(raw) || typeof raw.gameId !== 'string' || !isNum(raw.startedAt)) return null;
  return {
    gameId: raw.gameId,
    startedAt: raw.startedAt,
    baselineBpm: numOrNull(raw.baselineBpm),
    lastBpm: numOrNull(raw.lastBpm),
    lastValidAt: numOrNull(raw.lastValidAt),
    settledSince: numOrNull(raw.settledSince),
    firstBpm: numOrNull(raw.firstBpm),
    suggestedPauseUntil: numOrNull(raw.suggestedPauseUntil),
  };
}

/**
 * Restores engine state. A damaged cooldown entry restores as a cooldown starting now,
 * never as "unlocked": a corrupted file must not be a way around the lock.
 */
export function parseEngine(raw: unknown, now: number): EngineState {
  if (!isRec(raw)) return INITIAL_STATE;
  const losses = isNum(raw.consecutiveLosses) ? raw.consecutiveLosses : 0;
  if (raw.phase !== 'cooldown') return { phase: 'playing', consecutiveLosses: losses };
  const cooldown = parseCooldown(raw.cooldown) ?? {
    gameId: 'unknown',
    startedAt: now,
    baselineBpm: null,
    lastBpm: null,
    lastValidAt: null,
    settledSince: null,
    firstBpm: null,
    suggestedPauseUntil: null,
  };
  // A pre-restart signal is never fresh after a restart.
  return {
    phase: 'cooldown',
    consecutiveLosses: losses,
    cooldown: { ...cooldown, settledSince: null, lastValidAt: null },
  };
}

export function parseState(raw: unknown, now: number): PersistedState | null {
  if (!isRec(raw) || raw.version !== 1) return null;
  return { version: 1, profile: parseProfile(raw.profile), engine: parseEngine(raw.engine, now) };
}

export function parseLog(raw: unknown): PersistedLog | null {
  if (!isRec(raw) || raw.version !== 1 || !Array.isArray(raw.games)) return null;
  const games = raw.games.filter(
    (g): g is GameLogEntry => isRec(g) && typeof g.gameId === 'string' && isNum(g.endedAt),
  );
  return { version: 1, games };
}
