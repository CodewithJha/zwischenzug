import { describe, expect, it } from 'vitest';
import { logToCsv } from '../src/core/export';
import { freshState, parseEngine, parseLog, parseState } from '../src/core/persisted';

const NOW = 1_800_000_000_000;

describe('parseState', () => {
  it('rejects non-objects and unknown versions', () => {
    expect(parseState(null, NOW)).toBeNull();
    expect(parseState({ version: 2 }, NOW)).toBeNull();
  });

  it('round-trips a fresh state', () => {
    const s = freshState();
    expect(parseState(JSON.parse(JSON.stringify(s)), NOW)).toEqual(s);
  });

  it('drops malformed profile fields', () => {
    const s = parseState(
      {
        version: 1,
        profile: { consent: { at: 'x', mode: 'camera' }, username: 42, baseline: { bpm: 70 } },
      },
      NOW,
    );
    expect(s?.profile).toEqual({ consent: null, username: null, baseline: null });
  });
});

describe('parseEngine (restart persistence)', () => {
  it('restores an active cooldown with its original start time', () => {
    const e = parseEngine(
      {
        phase: 'cooldown',
        consecutiveLosses: 2,
        cooldown: {
          gameId: 'abcdefgh',
          startedAt: NOW - 30_000,
          baselineBpm: 70,
          lastBpm: 72,
          lastValidAt: NOW - 1000,
          settledSince: NOW - 10_000,
          firstBpm: 85,
          suggestedPauseUntil: null,
        },
      },
      NOW,
    );
    expect(e.phase).toBe('cooldown');
    if (e.phase !== 'cooldown') throw new Error('unreachable');
    expect(e.cooldown.startedAt).toBe(NOW - 30_000);
    expect(e.consecutiveLosses).toBe(2);
    // Pre-restart signal must not count toward unlocking after a restart.
    expect(e.cooldown.settledSince).toBeNull();
    expect(e.cooldown.lastValidAt).toBeNull();
  });

  it('a cooldown that starts in the future (clock moved back) restarts now', () => {
    const e = parseEngine(
      { phase: 'cooldown', cooldown: { gameId: 'abcdefgh', startedAt: NOW + 3_600_000 } },
      NOW,
    );
    if (e.phase !== 'cooldown') throw new Error('expected a cooldown');
    expect(e.cooldown.startedAt).toBe(NOW);
  });

  it('a damaged cooldown restores as a new cooldown, never as unlocked', () => {
    const e = parseEngine({ phase: 'cooldown', cooldown: { gameId: 5 } }, NOW);
    expect(e.phase).toBe('cooldown');
    if (e.phase !== 'cooldown') throw new Error('unreachable');
    expect(e.cooldown.startedAt).toBe(NOW);
  });
});

describe('parseLog', () => {
  it('filters malformed entries', () => {
    const log = parseLog({
      version: 1,
      games: [{ gameId: 'a', endedAt: 1, outcome: 'win' }, { gameId: 3 }, null],
    });
    expect(log?.games).toHaveLength(1);
  });

  it('skips entries that would break the game list or CSV export, keeping valid ones', () => {
    const ok = { gameId: 'ok', endedAt: NOW, outcome: 'loss', userColor: 'white', speed: 'blitz' };
    const log = parseLog({
      version: 1,
      games: [
        { ...ok, gameId: 'badOutcome', outcome: 42 },
        { ...ok, gameId: 'farFuture', endedAt: 1e20 },
        { ...ok, gameId: 'badSpeed', speed: 7 },
        ok,
        { ...ok, gameId: 'noSpeed', speed: null },
      ],
    });
    expect(log?.games.map((g) => g.gameId)).toEqual(['ok', 'noSpeed']);
    expect(() => logToCsv(log?.games ?? [])).not.toThrow();
  });
});
