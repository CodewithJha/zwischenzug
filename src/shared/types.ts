export type CameraMode = 'camera' | 'timer-only';
export type Outcome = 'win' | 'loss' | 'draw';
export type Color = 'white' | 'black';
export type UnlockReason = 'biometric' | 'timer' | 'override';

export interface Profile {
  consent: { at: number; mode: CameraMode } | null;
  username: string | null;
  baseline: { bpm: number; at: number; samples: number } | null;
}

/** A finished game from the user's point of view, as reported by a GameSource. */
export interface FinishedGame {
  gameId: string;
  outcome: Outcome;
  userColor: Color;
  speed: string | null;
  endedAt: number;
}

export interface GameLogEntry {
  gameId: string;
  endedAt: number;
  outcome: Outcome;
  userColor: Color;
  speed: string | null;
  /** Losses in a row after this game (0 after a win or draw). Missing in older logs. */
  consecutiveLosses?: number;
  /** Present only for losses that started a cooldown. */
  cooldown: {
    baselineBpm: number | null;
    pulseAtLossBpm: number | null;
    timeToUnlockSec: number;
    unlockReason: UnlockReason;
  } | null;
}

export type Screen = 'consent' | 'setup' | 'calibration' | 'playing' | 'cooldown' | 'diagnostics';

export interface CooldownView {
  gameId: string;
  baselineBpm: number | null;
  upperBandBpm: number | null;
  lastBpm: number | null;
  signalFresh: boolean;
  settledForSec: number;
  sustainSec: number;
  minWaitRemainingSec: number;
  /** Seconds until the no-signal timer would unlock (it only applies while the signal is lost). */
  fallbackRemainingSec: number;
  maxRemainingSec: number;
  suggestedPauseUntil: number | null;
}

export type IdentityStatus = 'checking' | 'verified' | 'signed-out' | 'wrong-account' | 'error';

/** Who is signed in to the embedded Lichess session, compared with the configured account. */
export interface IdentityView {
  status: IdentityStatus;
  signedInAs: string | null;
  message: string;
}

export interface AppSnapshot {
  screen: Screen;
  profile: Profile;
  consecutiveLosses: number;
  cooldown: CooldownView | null;
  lichess: { status: 'idle' | 'watching' | 'error'; message: string | null };
  identity: IdentityView;
  presage: { sdkLoaded: boolean; sdkError: string | null; apiKeyConfigured: boolean };
  settings: {
    overrideSentence: string;
    calibrationSec: number;
    calibrationMinSamples: number;
    escalateAfterLosses: number;
  };
}

export interface PresageRendererConfig {
  apiKey: string;
  enableTelemetry: boolean;
}

/** Environment facts for the diagnostics screen. Never contains the API key itself. */
export interface DiagnosticsInfo {
  apiKeySource: 'env' | 'saved' | null;
  /** OS camera permission for this app (macOS/Windows), without prompting. */
  cameraPermission: 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown';
  sdkVersion: string | null;
  electronVersion: string;
  platform: string;
  packaged: boolean;
}
