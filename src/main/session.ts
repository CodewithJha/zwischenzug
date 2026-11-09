import type { Config } from '../core/config';
import {
  cooldownRules,
  cooldownView,
  step,
  type CooldownRules,
  type EngineEvent,
  type Unlock,
} from '../core/cooldown';
import { logToCsv } from '../core/export';
import { identityView, playBlocked, type IdentityObservation } from '../core/identity';
import { freshState, type PersistedLog, type PersistedState } from '../core/persisted';
import type { Result } from '../shared/ipc';
import type { AppSnapshot, CameraMode, FinishedGame, GameLogEntry, Screen } from '../shared/types';
import { logger } from './log';
import type { JsonFile } from './store';

export interface SessionDeps {
  config: Config;
  stateFile: JsonFile<PersistedState>;
  logFile: JsonFile<PersistedLog>;
  presageStatus: () => { sdkLoaded: boolean; sdkError: string | null };
  hasApiKey: () => boolean;
  /** Delete-all beyond state and log: saved key, damaged copies, logs, Lichess session. */
  eraseLocalData: () => void;
  now?: () => number;
}

const USERNAME_RE = /^[a-zA-Z0-9_-]{2,30}$/;
const plausibleBpm = (bpm: number): boolean => Number.isFinite(bpm) && bpm >= 30 && bpm <= 220;
const normalize = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** Owns app state: profile, cooldown engine, game log. Single source of truth for the lock. */
export class Session {
  private state: PersistedState;
  private games: GameLogEntry[];
  private recalibrating = false;
  private diagnostics = false;
  private lichess: AppSnapshot['lichess'] = { status: 'idle', message: null };
  private lichessPage: AppSnapshot['lichessPage'] = { status: 'ok' };
  /** In memory only: never trust a sign-in from a previous run. */
  private identity: IdentityObservation = { kind: 'checking' };
  private readonly rules: CooldownRules;
  private readonly now: () => number;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: SessionDeps) {
    this.now = deps.now ?? Date.now;
    this.rules = cooldownRules(deps.config);
    this.state = deps.stateFile.read();
    this.games = deps.logFile.read().games;
    if (this.state.engine.phase === 'cooldown') {
      logger.info('restored an active cooldown from disk');
    }
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Re-publish the snapshot after an external change (e.g. API key saved, SDK loaded). */
  notify(): void {
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  private persist(): void {
    this.deps.stateFile.write(this.state);
  }

  get screen(): Screen {
    const { profile, engine } = this.state;
    if (!profile.consent) return 'consent';
    if (!profile.username) return 'setup';
    if (engine.phase === 'cooldown') return 'cooldown';
    if (this.diagnostics) return 'diagnostics';
    if (profile.consent.mode === 'camera' && (!profile.baseline || this.recalibrating)) {
      return 'calibration';
    }
    return 'playing';
  }

  get locked(): boolean {
    return this.state.engine.phase === 'cooldown';
  }

  /** True while Lichess play requests must be cancelled (cooldown or unverified sign-in). */
  get playBlocked(): boolean {
    return playBlocked(this.locked, this.identityView());
  }

  get identityVerified(): boolean {
    return this.identityView().status === 'verified';
  }

  private identityView(): AppSnapshot['identity'] {
    return identityView(this.identity, this.state.profile.username);
  }

  get username(): string | null {
    return this.state.profile.username;
  }

  get cameraAllowed(): boolean {
    return this.state.profile.consent?.mode === 'camera';
  }

  snapshot(): AppSnapshot {
    const { profile, engine } = this.state;
    const { cooldown: c } = this.deps.config;
    return {
      screen: this.screen,
      profile,
      consecutiveLosses: engine.consecutiveLosses,
      cooldown:
        engine.phase === 'cooldown' ? cooldownView(engine.cooldown, this.now(), this.rules) : null,
      lichess: this.lichess,
      lichessPage: this.lichessPage,
      identity: this.identityView(),
      presage: { ...this.deps.presageStatus(), apiKeyConfigured: this.deps.hasApiKey() },
      settings: {
        overrideSentence: c.overrideSentence,
        calibrationSec: this.deps.config.calibration.durationSec,
        calibrationMinSamples: this.deps.config.calibration.minSamples,
        escalateAfterLosses: c.escalateAfterLosses,
      },
    };
  }

  giveConsent(mode: CameraMode): Result {
    this.state.profile.consent = { at: this.now(), mode };
    this.recalibrating = false;
    this.persist();
    logger.info(`consent recorded (mode=${mode})`);
    this.emit();
    return { ok: true };
  }

  setUsername(raw: string): Result {
    const name = raw.trim();
    if (!USERNAME_RE.test(name))
      return { ok: false, error: 'That is not a valid Lichess username.' };
    this.state.profile.username = name;
    this.persist();
    this.emit();
    return { ok: true };
  }

  saveBaseline(bpm: number, samples: number): Result {
    if (!plausibleBpm(bpm) || !Number.isInteger(samples) || samples < 1) {
      return { ok: false, error: 'Baseline out of range.' };
    }
    this.state.profile.baseline = { bpm: Math.round(bpm * 10) / 10, at: this.now(), samples };
    this.recalibrating = false;
    this.persist();
    logger.info(`baseline saved from ${samples} samples`);
    this.emit();
    return { ok: true };
  }

  recalibrate(): Result {
    if (!this.state.profile.consent) return { ok: false, error: 'Consent first.' };
    if (this.locked) return { ok: false, error: 'Not during a cooldown.' };
    this.state.profile.consent = { at: this.now(), mode: 'camera' };
    this.recalibrating = true;
    this.persist();
    this.emit();
    return { ok: true };
  }

  /** In-memory only: the diagnostics screen never survives a restart or a loss. */
  setDiagnostics(open: boolean): Result {
    if (open && (this.locked || !this.state.profile.consent || !this.state.profile.username)) {
      return { ok: false, error: 'Diagnostics are not available right now.' };
    }
    this.diagnostics = open;
    this.emit();
    return { ok: true };
  }

  setLichessStatus(status: AppSnapshot['lichess']): void {
    this.lichess = status;
    this.emit();
  }

  get lichessPageFailed(): boolean {
    return this.lichessPage.status === 'failed';
  }

  setLichessPage(page: AppSnapshot['lichessPage']): void {
    this.lichessPage = page;
    this.emit();
  }

  setIdentity(obs: IdentityObservation): void {
    const before = this.identityView().status;
    this.identity = obs;
    const after = this.identityView().status;
    if (before !== after) logger.info(`lichess sign-in: ${before} -> ${after}`);
    this.emit();
  }

  gameFinished(game: FinishedGame): void {
    if (this.games.some((g) => g.gameId === game.gameId)) return;
    logger.info(`game ${game.gameId} finished: ${game.outcome}`);
    const entry: GameLogEntry = { ...game, cooldown: null };
    this.games.push(entry);
    this.apply({
      type: 'GAME_FINISHED',
      gameId: game.gameId,
      outcome: game.outcome,
      baselineBpm: this.cameraAllowed ? (this.state.profile.baseline?.bpm ?? null) : null,
      at: this.now(),
    });
    entry.consecutiveLosses = this.state.engine.consecutiveLosses;
    this.deps.logFile.write({ version: 1, games: this.games });
  }

  pulse(bpm: number, stable: boolean): void {
    // An implausible reading counts as no reading, so it can neither settle nor extend the lock.
    if (!this.locked || !this.cameraAllowed || !plausibleBpm(bpm)) return;
    this.apply({ type: 'PULSE', bpm, stable, at: this.now() });
  }

  tick(): void {
    if (this.locked) this.apply({ type: 'TICK', at: this.now() });
  }

  override(sentence: string): Result {
    if (!this.locked) return { ok: false, error: 'No active cooldown.' };
    if (normalize(sentence) !== normalize(this.deps.config.cooldown.overrideSentence)) {
      return { ok: false, error: 'The sentence does not match.' };
    }
    this.apply({ type: 'OVERRIDE', at: this.now() });
    return { ok: true };
  }

  getLog(): GameLogEntry[] {
    return [...this.games].reverse();
  }

  /** The log oldest first, as a file the user chose to save. */
  exportLog(format: 'csv' | 'json'): string {
    return format === 'csv'
      ? logToCsv(this.games)
      : JSON.stringify({ version: 1, games: this.games }, null, 2);
  }

  deleteAll(): Result {
    if (this.locked) return { ok: false, error: 'Finish or skip the cooldown first.' };
    this.games = [];
    this.deps.logFile.delete();
    this.deps.eraseLocalData();
    this.state = freshState();
    this.recalibrating = false;
    this.diagnostics = false;
    this.persist();
    logger.info('all local data deleted');
    this.emit();
    return { ok: true };
  }

  private apply(event: EngineEvent): void {
    const before = this.state.engine;
    const { state, unlock } = step(before, event, this.rules);
    this.state.engine = state;
    const phaseChanged = before.phase !== state.phase;
    const firstReading =
      before.phase === 'cooldown' &&
      state.phase === 'cooldown' &&
      before.cooldown.firstBpm === null &&
      state.cooldown.firstBpm !== null;
    if (unlock) this.recordUnlock(unlock);
    if (phaseChanged) this.diagnostics = false;
    if (phaseChanged || firstReading || event.type === 'GAME_FINISHED') this.persist();
    if (phaseChanged) logger.info(`engine: ${before.phase} -> ${state.phase}`);
    this.emit();
  }

  private recordUnlock({ cooldown: c, reason, at }: Unlock): void {
    logger.info(`cooldown for ${c.gameId} unlocked (${reason})`);
    const entry = this.games.find((g) => g.gameId === c.gameId);
    if (!entry) return;
    entry.cooldown = {
      baselineBpm: c.baselineBpm,
      pulseAtLossBpm: c.firstBpm,
      timeToUnlockSec: Math.round((at - c.startedAt) / 1000),
      unlockReason: reason,
    };
    this.deps.logFile.write({ version: 1, games: this.games });
  }
}
