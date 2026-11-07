import { describe, expect, it } from 'vitest';
import type { AppSnapshot, CooldownView } from '../../src/shared/types';
import { unlockPath } from '../../src/renderer/views/unlock-path';

const cooldown = (over: Partial<CooldownView> = {}): CooldownView => ({
  gameId: 'game0001',
  baselineBpm: 80,
  upperBandBpm: 86,
  lastBpm: null,
  pulseAtLossBpm: null,
  signalFresh: false,
  settledForSec: 0,
  sustainSec: 15,
  minWaitSec: 60,
  minWaitRemainingSec: 30,
  fallbackSec: 180,
  fallbackRemainingSec: 150,
  maxRemainingSec: 870,
  suggestedPauseUntil: null,
  ...over,
});

const snap = (over: Partial<AppSnapshot> = {}, c: CooldownView = cooldown()): AppSnapshot => ({
  screen: 'cooldown',
  profile: { consent: { at: 0, mode: 'camera' }, username: 'u', baseline: null },
  consecutiveLosses: 1,
  cooldown: c,
  lichess: { status: 'watching', message: null },
  lichessPage: { status: 'ok' },
  identity: { status: 'verified', signedInAs: 'u', message: '' },
  presage: { sdkLoaded: true, sdkError: null, apiKeyConfigured: true },
  settings: {
    overrideSentence: 'x',
    calibrationSec: 60,
    calibrationMinSamples: 10,
    escalateAfterLosses: 5,
  },
  ...over,
});

describe('unlockPath', () => {
  it('is the pulse path while a fresh reading exists', () => {
    expect(unlockPath(snap({}, cooldown({ signalFresh: true, lastBpm: 90 })), null).kind).toBe(
      'pulse',
    );
  });

  it('waits (timer still counting) while the camera starts or readings are not steady', () => {
    expect(unlockPath(snap(), null).kind).toBe('waiting');
    expect(unlockPath(snap(), { kind: 'starting' }).kind).toBe('waiting');
    expect(unlockPath(snap(), { kind: 'measuring', ok: true, hint: null }).kind).toBe('waiting');
  });

  it('is the timer path with the reason when there is no usable signal', () => {
    expect(unlockPath(snap(), { kind: 'measuring', ok: false, hint: 'No face in view.' })).toEqual({
      kind: 'timer',
      reason: 'No face in view.',
    });
    expect(
      unlockPath(snap(), { kind: 'unavailable', reason: 'Presage rejected the API key.' }),
    ).toEqual({ kind: 'timer', reason: 'Presage rejected the API key.' });
  });

  it('names why pulse unlock is impossible', () => {
    const timerOnly = snap({
      profile: { consent: { at: 0, mode: 'timer-only' }, username: 'u', baseline: null },
    });
    expect(unlockPath(timerOnly, null)).toMatchObject({ kind: 'timer', reason: /timer only/ });
    expect(unlockPath(snap({}, cooldown({ baselineBpm: null })), null)).toMatchObject({
      kind: 'timer',
      reason: /No baseline/,
    });
    const noKey = snap({ presage: { sdkLoaded: true, sdkError: null, apiKeyConfigured: false } });
    expect(unlockPath(noKey, null)).toMatchObject({ kind: 'timer', reason: /API key/ });
    const noSdk = snap({
      presage: { sdkLoaded: false, sdkError: 'native load failed', apiKeyConfigured: true },
    });
    expect(unlockPath(noSdk, null)).toEqual({ kind: 'timer', reason: 'native load failed' });
  });

  it('prefers a provider failure over a stale fresh flag', () => {
    const c = cooldown({ signalFresh: true, lastBpm: 90 });
    expect(unlockPath(snap({}, c), { kind: 'unavailable', reason: 'Camera off.' }).kind).toBe(
      'timer',
    );
  });
});
