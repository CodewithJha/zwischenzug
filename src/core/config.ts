/** All tunables in one place. Durations are seconds/minutes in config, ms in the engine. */
export interface Config {
  cooldown: {
    /** No unlock (biometric or timer) before this many seconds after the loss. */
    minWaitSec: number;
    /** Settled when pulse <= baseline + max(toleranceBpm, baseline * tolerancePct / 100). */
    toleranceBpm: number;
    tolerancePct: number;
    /** How long pulse must stay settled, with a fresh signal, to unlock. */
    sustainSec: number;
    /** Without a usable signal, unlock by timer after this many seconds. */
    fallbackSec: number;
    /** Hard ceiling: never hold the lock longer than this. */
    maxSec: number;
    /** A signal older than this counts as lost. */
    signalTimeoutSec: number;
    /** After this many consecutive losses, suggest a longer pause. */
    escalateAfterLosses: number;
    suggestedPauseMin: number;
    /** Typed (case-insensitive) to skip a cooldown. */
    overrideSentence: string;
  };
  calibration: {
    durationSec: number;
    /** Minimum stable pulse samples needed to accept a baseline. */
    minSamples: number;
  };
  lichess: {
    origin: string;
    /** Poll /api/user/{name}/current-game this often as a backup to the game stream. */
    pollIntervalSec: number;
    /** Ignore finished games older than this when first seen (e.g. right after launch). */
    recentGameWindowMin: number;
  };
  presage: {
    /** SDK telemetry is on by default upstream; we default it off. */
    enableTelemetry: boolean;
  };
}

export const DEFAULT_CONFIG: Config = {
  cooldown: {
    minWaitSec: 60,
    toleranceBpm: 5,
    tolerancePct: 7,
    sustainSec: 15,
    fallbackSec: 180,
    maxSec: 900,
    signalTimeoutSec: 5,
    escalateAfterLosses: 5,
    suggestedPauseMin: 30,
    overrideSentence: 'I choose to skip this cooldown and play now',
  },
  calibration: { durationSec: 60, minSamples: 10 },
  lichess: { origin: 'https://lichess.org', pollIntervalSec: 10, recentGameWindowMin: 10 },
  presage: { enableTelemetry: false },
};

type Env = Record<string, string | undefined>;

/** Env var -> [section, key]. Only numeric/boolean tunables are env-overridable. */
const ENV_KEYS: Record<string, [keyof Config, string]> = {
  ZZ_MIN_WAIT_SEC: ['cooldown', 'minWaitSec'],
  ZZ_TOLERANCE_BPM: ['cooldown', 'toleranceBpm'],
  ZZ_TOLERANCE_PCT: ['cooldown', 'tolerancePct'],
  ZZ_SUSTAIN_SEC: ['cooldown', 'sustainSec'],
  ZZ_FALLBACK_SEC: ['cooldown', 'fallbackSec'],
  ZZ_MAX_COOLDOWN_SEC: ['cooldown', 'maxSec'],
  ZZ_ESCALATE_AFTER_LOSSES: ['cooldown', 'escalateAfterLosses'],
  ZZ_CALIBRATION_SEC: ['calibration', 'durationSec'],
  ZZ_LICHESS_POLL_SEC: ['lichess', 'pollIntervalSec'],
  PRESAGE_ENABLE_TELEMETRY: ['presage', 'enableTelemetry'],
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function coerce(defaultValue: unknown, raw: unknown): unknown {
  if (typeof defaultValue === 'number') {
    const n = typeof raw === 'string' ? Number(raw) : raw;
    return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined;
  }
  if (typeof defaultValue === 'boolean') {
    if (typeof raw === 'boolean') return raw;
    if (raw === 'true' || raw === '1') return true;
    if (raw === 'false' || raw === '0') return false;
    return undefined;
  }
  return typeof raw === 'string' && raw.trim() !== '' ? raw : undefined;
}

/**
 * Merges defaults <- config file <- env. Unknown keys and invalid values are ignored
 * (and reported) rather than crashing the app.
 */
export function resolveConfig(file: unknown, env: Env): { config: Config; warnings: string[] } {
  const warnings: string[] = [];
  const config = structuredClone(DEFAULT_CONFIG) as unknown as Record<
    string,
    Record<string, unknown>
  >;
  const apply = (section: string, key: string, raw: unknown, source: string): void => {
    const target = config[section];
    if (!target || !(key in target)) {
      warnings.push(`${source}: unknown setting ${section}.${key}`);
      return;
    }
    const value = coerce(target[key], raw);
    if (value === undefined) warnings.push(`${source}: invalid value for ${section}.${key}`);
    else target[key] = value;
  };

  if (isRecord(file)) {
    for (const [section, values] of Object.entries(file)) {
      if (!isRecord(values)) continue;
      for (const [key, raw] of Object.entries(values)) apply(section, key, raw, 'config file');
    }
  }
  for (const [name, [section, key]] of Object.entries(ENV_KEYS)) {
    if (env[name] !== undefined) apply(section, key, env[name], name);
  }

  const result = config as unknown as Config;
  if (result.cooldown.fallbackSec < result.cooldown.minWaitSec) {
    warnings.push('cooldown.fallbackSec < minWaitSec; using minWaitSec');
    result.cooldown.fallbackSec = result.cooldown.minWaitSec;
  }
  if (result.cooldown.maxSec < result.cooldown.fallbackSec) {
    warnings.push('cooldown.maxSec < fallbackSec; using fallbackSec');
    result.cooldown.maxSec = result.cooldown.fallbackSec;
  }
  if (result.lichess.pollIntervalSec < 3) {
    warnings.push('lichess.pollIntervalSec below 3s is unfriendly to Lichess; using 3');
    result.lichess.pollIntervalSec = 3;
  }
  return { config: result, warnings };
}
