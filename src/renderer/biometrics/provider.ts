export interface PulseReading {
  bpm: number;
  /** Provider's own reliability flag (Presage: confidence >= 40, about +/-3 bpm). */
  stable: boolean;
}

export type ProviderState =
  | { kind: 'starting' }
  | { kind: 'measuring'; ok: boolean; hint: string | null }
  /** No usable signal source: callers fall back to the timer. */
  | { kind: 'unavailable'; reason: string };

export interface ProviderHandlers {
  reading(r: PulseReading): void;
  state(s: ProviderState): void;
  /** Camera stream for an optional local preview. */
  stream?(s: MediaStream): void;
}

/** A source of live pulse readings. Presage SmartSpectra today; others can plug in later. */
export interface BiometricProvider {
  start(handlers: ProviderHandlers): Promise<void>;
  /** Stops measuring and releases the camera. Safe to call repeatedly. */
  stop(): Promise<void>;
}
