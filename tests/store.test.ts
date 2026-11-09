import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  failClosedState,
  freshState,
  parseState,
  type PersistedState,
} from '../src/core/persisted';

vi.mock('../src/main/log', () => ({
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
}));
const { JsonFile } = await import('../src/main/store');

const NOW = 1_800_000_000_000;
let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'zz-store-'));
  file = path.join(dir, 'state.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const stateFile = () =>
  new JsonFile<PersistedState>(file, (raw) => parseState(raw, NOW), freshState, {
    backup: true,
    corrupt: () => failClosedState(NOW),
  });

const cooling: PersistedState = {
  version: 1,
  profile: { consent: { at: 1, mode: 'camera' }, username: 'me', baseline: null },
  engine: {
    phase: 'cooldown',
    consecutiveLosses: 2,
    cooldown: {
      gameId: 'AAAA0001',
      startedAt: NOW - 30_000,
      baselineBpm: 70,
      lastBpm: null,
      lastValidAt: null,
      settledSince: null,
      firstBpm: null,
      suggestedPauseUntil: null,
    },
  },
};

describe('JsonFile state recovery', () => {
  it.each([
    ['truncated', (t: string) => t.slice(0, t.length / 2)],
    ['garbage', () => '\u0000\u0001binary'],
    ['version mismatch', (t: string) => t.replace('"version": 1', '"version": 2')],
  ])('%s state.json with a good backup restores the cooldown and profile', (_, damage) => {
    stateFile().write(cooling);
    writeFileSync(file, damage(readFileSync(file, 'utf8')));
    expect(stateFile().read()).toEqual(cooling);
  });

  it('a deleted state.json is restored from the backup', () => {
    stateFile().write(cooling);
    rmSync(file);
    expect(stateFile().read()).toEqual(cooling);
  });

  it('fails closed (locked) when the file is damaged and there is no valid backup', () => {
    writeFileSync(file, '{"version":1,"engine":');
    const s = stateFile().read();
    expect(s.engine.phase).toBe('cooldown');
  });

  it('first run (no files) starts fresh, and delete() removes the backup too', () => {
    const f = stateFile();
    expect(f.read()).toEqual(freshState());
    f.write(cooling);
    f.delete();
    expect(existsSync(file) || existsSync(`${file}.bak`)).toBe(false);
  });
});
