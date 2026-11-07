import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, resolveConfig } from '../src/core/config';

describe('resolveConfig', () => {
  it('returns defaults with no file and no env', () => {
    const { config, warnings } = resolveConfig(undefined, {});
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(warnings).toEqual([]);
  });

  it('applies file then env, env winning', () => {
    const { config } = resolveConfig(
      { cooldown: { minWaitSec: 90, overrideSentence: 'let me play' } },
      { ZZ_MIN_WAIT_SEC: '120', PRESAGE_ENABLE_TELEMETRY: 'true' },
    );
    expect(config.cooldown.minWaitSec).toBe(120);
    expect(config.cooldown.overrideSentence).toBe('let me play');
    expect(config.presage.enableTelemetry).toBe(true);
  });

  it('defaults Presage telemetry off', () => {
    expect(resolveConfig(undefined, {}).config.presage.enableTelemetry).toBe(false);
  });

  it('ignores unknown keys and invalid values with warnings', () => {
    const { config, warnings } = resolveConfig(
      { cooldown: { minWaitSec: -5, nope: 1 }, bogus: { a: 1 } },
      { ZZ_SUSTAIN_SEC: 'abc' },
    );
    expect(config.cooldown.minWaitSec).toBe(DEFAULT_CONFIG.cooldown.minWaitSec);
    expect(config.cooldown.sustainSec).toBe(DEFAULT_CONFIG.cooldown.sustainSec);
    expect(warnings).toHaveLength(4);
  });

  it('keeps durations consistent: min wait <= fallback <= max', () => {
    const { config } = resolveConfig(
      { cooldown: { minWaitSec: 300, fallbackSec: 100, maxSec: 50 } },
      {},
    );
    expect(config.cooldown.fallbackSec).toBe(300);
    expect(config.cooldown.maxSec).toBe(300);
  });

  it('does not let polling hammer Lichess', () => {
    expect(resolveConfig({}, { ZZ_LICHESS_POLL_SEC: '1' }).config.lichess.pollIntervalSec).toBe(3);
  });

  it('does not mutate the defaults', () => {
    resolveConfig({ cooldown: { minWaitSec: 999 } }, {});
    expect(DEFAULT_CONFIG.cooldown.minWaitSec).toBe(60);
  });
});
