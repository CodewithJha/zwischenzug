import type { Config } from '../../core/config';
import { gameIdFromUrl } from '../../core/lichess-url';
import { parseGame } from '../../core/lichess-game';
import { ndjsonSplitter } from '../../core/ndjson';
import type { GameSource, GameSourceEvents } from '../game-source';
import { logger } from '../log';

const MAX_STREAMS = 2; // Lichess allows 8 game streams per IP; we need one.
const RATE_LIMIT_BACKOFF_MS = 60_000; // Lichess: on 429, wait a minute.
/** Export checks for a live game without an open stream; the last delay repeats. */
const EXPORT_RETRY_MS = [1000, 3000, 8000, 20_000, 60_000];

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Detects finished games with Lichess's public, unauthenticated API:
 * - polls GET /api/user/{name}/current-game (ongoing game, or the last one played);
 * - for a game seen in progress, holds GET /api/stream/game/{id} open; its final line is
 *   the finished game, sent at game end. Without a stream (slots full, or it dropped), the
 *   game is checked with GET /game/export/{id} until it ends.
 * Only games seen in progress count (plus current-game's last game right after launch):
 * a stream replays a long-finished game from a first line that has no status, so opening
 * an old game in the view must not look like a fresh result.
 */
export class LichessGameSource implements GameSource {
  private username: string | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private readonly streams = new Map<string, AbortController>();
  /** Games with a known outcome (finished, aborted, or not the user's). */
  private readonly resolved = new Set<string>();
  /** Games current-game or an export showed in progress. */
  private readonly live = new Set<string>();
  /** Finished before they were seen in progress, or not games at all (from page URLs). */
  private readonly history = new Set<string>();
  /** Games with an export check running, and how many checks each has had. */
  private readonly exporting = new Set<string>();
  private readonly exportAttempts = new Map<string, number>();

  constructor(
    private readonly config: Config['lichess'],
    private readonly events: GameSourceEvents,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  start(username: string): void {
    this.halt();
    this.username = username;
    this.events.status({ status: 'watching', message: 'watching for finished games' });
    void this.poll();
  }

  stop(): void {
    this.halt();
    this.events.status({ status: 'idle', message: null });
  }

  private halt(): void {
    this.username = null;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    for (const c of this.streams.values()) c.abort();
    this.streams.clear();
  }

  noteUrl(url: string): void {
    const id = gameIdFromUrl(url);
    if (id) void this.checkGame(id);
  }

  /** A page URL is only a hint: one export says whether the game is in progress. */
  private async checkGame(gameId: string): Promise<void> {
    const known = [this.resolved, this.live, this.history, this.exporting];
    if (!this.username || known.some((s) => s.has(gameId))) return;
    this.exporting.add(gameId);
    try {
      if ((await this.fetchExport(gameId)) === 'missing') this.history.add(gameId);
    } finally {
      this.exporting.delete(gameId);
    }
    if (this.live.has(gameId)) this.watchGame(gameId);
  }

  /** Fetches /game/export/{id} and handles the result. */
  private async fetchExport(gameId: string): Promise<'ok' | 'missing' | 'limited' | 'failed'> {
    const url = `${this.config.origin}/game/export/${encodeURIComponent(gameId)}?moves=false&clocks=false&evals=false&opening=false`;
    try {
      const res = await this.fetchImpl(url, { headers: { Accept: 'application/json' } });
      if (res.status === 429) return 'limited';
      if (res.status === 404) return 'missing';
      if (!res.ok) return 'failed';
      this.handleGameJson(await res.json(), 'export');
      return 'ok';
    } catch (err) {
      logger.warn(`export ${gameId} failed: ${String(err)}`);
      return 'failed';
    }
  }

  private schedulePoll(delayMs: number): void {
    if (!this.username) return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => void this.poll(), delayMs);
  }

  private async poll(): Promise<void> {
    const username = this.username;
    if (!username) return;
    const interval = this.config.pollIntervalSec * 1000;
    // Keep polling while streams are open: they may belong to other (e.g. correspondence) games.
    const url = `${this.config.origin}/api/user/${encodeURIComponent(username)}/current-game?moves=false&clocks=false&evals=false&opening=false`;
    try {
      const res = await this.fetchImpl(url, { headers: { Accept: 'application/json' } });
      if (res.status === 429) {
        this.events.status({ status: 'error', message: 'Lichess rate limit; waiting a minute' });
        return this.schedulePoll(RATE_LIMIT_BACKOFF_MS);
      }
      if (res.status === 404) {
        // Also returned for accounts with no games yet.
        this.events.status({ status: 'watching', message: 'no games found yet for this account' });
        return this.schedulePoll(interval);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.handleGameJson(await res.json(), 'poll');
      this.events.status({ status: 'watching', message: 'watching for finished games' });
      this.schedulePoll(interval);
    } catch (err) {
      logger.warn(`lichess poll failed: ${String(err)}`);
      this.events.status({ status: 'error', message: 'cannot reach Lichess; retrying' });
      this.schedulePoll(Math.min(interval * 3, 60_000));
    }
  }

  private handleGameJson(json: unknown, via: 'poll' | 'stream' | 'export'): void {
    const username = this.username;
    if (!username) return;
    const parsed = parseGame(json, username, Date.now());
    if (!parsed || this.resolved.has(parsed.gameId)) return;
    const id = parsed.gameId;
    if (parsed.state === 'ongoing') {
      // A stream's first line has no status even for a long-finished game: not proof of play.
      if (via === 'stream') return;
      this.live.add(id);
      this.watchGame(id);
      return;
    }
    if (parsed.state === 'ignored') {
      this.resolved.add(id);
      return;
    }
    // Finished before it was seen in progress: an old game (e.g. opened in the view).
    // current-game may still report it right after launch, within the recent window.
    if (!this.live.has(id) && via !== 'poll') {
      this.history.add(id);
      return;
    }
    this.resolved.add(id);
    // endedAt is Lichess's lastMoveAt (polls, exports) or now (a live stream's final line).
    const ageMs = Date.now() - parsed.game.endedAt;
    if (ageMs > this.config.recentGameWindowMin * 60_000) return;
    this.events.finished(parsed.game);
  }

  private watchGame(gameId: string): void {
    if (!this.username || this.resolved.has(gameId) || this.streams.has(gameId)) return;
    if (this.exporting.has(gameId)) return;
    if (this.streams.size >= MAX_STREAMS) return void this.resolveByExport(gameId);
    const controller = new AbortController();
    this.streams.set(gameId, controller);
    void this.readStream(gameId, controller).finally(() => {
      this.streams.delete(gameId);
      // Seen live: if the stream closed without a final result, ask for this exact game
      // (current-game may already point at the user's next game).
      if (!controller.signal.aborted && !this.resolved.has(gameId))
        void this.resolveByExport(gameId);
      this.schedulePoll(1000);
    });
  }

  /** Checks a live game without a stream until it ends; re-streams it when a slot is free. */
  private async resolveByExport(gameId: string): Promise<void> {
    const username = this.username;
    if (!username || this.exporting.has(gameId)) return;
    this.exporting.add(gameId);
    try {
      for (;;) {
        const attempt = this.exportAttempts.get(gameId) ?? 0;
        this.exportAttempts.set(gameId, attempt + 1);
        if (attempt === EXPORT_RETRY_MS.length) logger.warn(`game ${gameId} still unresolved`);
        await sleep(EXPORT_RETRY_MS[Math.min(attempt, EXPORT_RETRY_MS.length - 1)] ?? 60_000);
        if (this.username !== username || this.resolved.has(gameId)) return;
        const result = await this.fetchExport(gameId);
        if (result === 'limited') await sleep(RATE_LIMIT_BACKOFF_MS);
        if (result === 'missing') return void this.resolved.add(gameId);
        if (this.resolved.has(gameId)) return;
        if (result === 'ok' && this.streams.size < MAX_STREAMS) break;
      }
    } finally {
      this.exporting.delete(gameId);
    }
    this.watchGame(gameId);
  }

  private async readStream(gameId: string, controller: AbortController): Promise<void> {
    const url = `${this.config.origin}/api/stream/game/${encodeURIComponent(gameId)}`;
    try {
      const res = await this.fetchImpl(url, { signal: controller.signal });
      if (!res.ok || !res.body) {
        logger.warn(`game stream ${gameId}: HTTP ${res.status}`);
        return;
      }
      logger.info(`streaming game ${gameId}`);
      let lines = 0;
      const push = ndjsonSplitter((value) => {
        lines++;
        this.handleGameJson(value, 'stream');
      });
      const decoder = new TextDecoder();
      for await (const chunk of res.body) {
        push(decoder.decode(chunk, { stream: true }));
        if (this.resolved.has(gameId)) break;
      }
      push('\n');
      logger.info(
        `game stream ${gameId} closed after ${lines} lines (resolved=${this.resolved.has(gameId)})`,
      );
    } catch (err) {
      if (!controller.signal.aborted) logger.warn(`game stream ${gameId} dropped: ${String(err)}`);
    }
  }
}
