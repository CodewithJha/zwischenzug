import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../src/core/config';
import { freshState, type PersistedLog, type PersistedState } from '../src/core/persisted';
import type { JsonFile } from '../src/main/store';

vi.mock('../src/main/log', () => ({
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
}));
const { Session } = await import('../src/main/session');

const memFile = <T>(initial: T): JsonFile<T> => {
  let value = initial;
  return {
    read: () => value,
    write: (v: T) => (value = structuredClone(v)),
    delete: () => undefined,
  } as unknown as JsonFile<T>;
};

function session(start = 0) {
  let now = start;
  const state: PersistedState = {
    ...freshState(),
    profile: {
      consent: { at: 0, mode: 'camera' },
      username: 'me',
      baseline: { bpm: 70, at: 0, samples: 30 },
    },
  };
  const s = new Session({
    config: DEFAULT_CONFIG,
    stateFile: memFile(state),
    logFile: memFile<PersistedLog>({ version: 1, games: [] }),
    presageStatus: () => ({ sdkLoaded: true, sdkError: null }),
    hasApiKey: () => true,
    eraseLocalData: () => undefined,
    now: () => now,
  });
  return { s, advance: (ms: number) => (now += ms) };
}

describe('Session.saveBaseline', () => {
  it.each([0, -5, 1.5, Number.NaN])('rejects %s samples', (samples) => {
    expect(session().s.saveBaseline(72, samples).ok).toBe(false);
  });

  it.each([29, 221, Number.NaN])('rejects %s bpm', (bpm) => {
    expect(session().s.saveBaseline(bpm, 30).ok).toBe(false);
  });

  it('accepts a plausible baseline', () => {
    const { s } = session();
    expect(s.saveBaseline(72.34, 30).ok).toBe(true);
    expect(s.snapshot().profile.baseline).toMatchObject({ bpm: 72.3, samples: 30 });
  });
});

describe('Session.pulse', () => {
  const lose = () => {
    const t = session(1_000_000);
    t.s.gameFinished({
      gameId: 'AAAA0001',
      outcome: 'loss',
      userColor: 'white',
      speed: 'bullet',
      endedAt: 1_000_000,
    });
    expect(t.s.locked).toBe(true);
    return t;
  };

  it('an implausibly low stable reading does not unlock by pulse', () => {
    const { s, advance } = lose();
    for (let i = 0; i < 70; i++) {
      advance(1000);
      s.pulse(1, true);
      s.tick();
    }
    expect(s.locked).toBe(true);
    expect(s.snapshot().cooldown?.pulseAtLossBpm).toBeNull();
  });

  it('implausibly high readings count as no reading, so the timer fallback still applies', () => {
    const { s, advance } = lose();
    for (let i = 0; i < 181; i++) {
      advance(1000);
      s.pulse(300, true);
      s.tick();
    }
    expect(s.locked).toBe(false);
    expect(s.getLog()[0]?.cooldown?.unlockReason).toBe('timer');
  });

  it('a plausible settled pulse still unlocks by pulse', () => {
    const { s, advance } = lose();
    for (let i = 0; i < 61; i++) {
      advance(1000);
      s.pulse(72, true);
      s.tick();
    }
    expect(s.locked).toBe(false);
    expect(s.getLog()[0]?.cooldown?.unlockReason).toBe('biometric');
  });
});
