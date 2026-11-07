import type {
  AppSnapshot,
  CameraMode,
  DiagnosticsInfo,
  GameLogEntry,
  PresageRendererConfig,
} from './types';

/** IPC channel names. Kept in one place so main and preload cannot drift. */
export const IPC = {
  snapshot: 'zz:snapshot',
  getSnapshot: 'zz:get-snapshot',
  giveConsent: 'zz:give-consent',
  setUsername: 'zz:set-username',
  saveBaseline: 'zz:save-baseline',
  recalibrate: 'zz:recalibrate',
  pulse: 'zz:pulse',
  override: 'zz:override',
  requestCamera: 'zz:request-camera',
  presageConfig: 'zz:presage-config',
  setPresageKey: 'zz:set-presage-key',
  getLog: 'zz:get-log',
  deleteAll: 'zz:delete-all',
  setDiagnostics: 'zz:set-diagnostics',
  getDiagnostics: 'zz:get-diagnostics',
  exportLog: 'zz:export-log',
  log: 'zz:log',
} as const;

export type Result = { ok: true } | { ok: false; error: string };

/** The only API the app renderer gets (window.zz). The Lichess view gets nothing. */
export interface ZzApi {
  getSnapshot(): Promise<AppSnapshot>;
  onSnapshot(listener: (snapshot: AppSnapshot) => void): () => void;
  giveConsent(mode: CameraMode): Promise<Result>;
  setUsername(username: string): Promise<Result>;
  saveBaseline(bpm: number, samples: number): Promise<Result>;
  /** Re-enter calibration (also switches timer-only users to camera mode). */
  recalibrate(): Promise<Result>;
  reportPulse(bpm: number, stable: boolean): void;
  override(sentence: string): Promise<Result>;
  /** Asks the OS for camera access (macOS). Resolves false if denied or not consented. */
  requestCamera(): Promise<boolean>;
  /** Null when no API key is configured. */
  getPresageConfig(): Promise<PresageRendererConfig | null>;
  setPresageKey(key: string): Promise<Result>;
  getLog(): Promise<GameLogEntry[]>;
  deleteAllData(): Promise<Result>;
  /** Opens or closes the SDK diagnostics screen (never during a cooldown). */
  setDiagnostics(open: boolean): Promise<Result>;
  getDiagnostics(): Promise<DiagnosticsInfo>;
  /** Saves the game log via a save dialog. */
  exportLog(format: 'csv' | 'json'): Promise<Result>;
  log(level: 'info' | 'warn' | 'error', message: string): void;
}
