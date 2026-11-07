import type { Config } from '../../core/config';
import { gameIdFromUrl } from '../../core/lichess-url';
import { parseGame } from '../../core/lichess-game';
import { ndjsonSplitter } from '../../core/ndjson';
import type { GameSource, GameSourceEvents } from '../game-source';
import { logger } from '../log';

const MAX_STREAMS = 2; // Lichess allows 8 game streams per IP; we need one.
const RATE_LIMIT_BACKOFF_MS = 60_000; // Lichess: on 429, wait a minute.

/**
 * Detects finished games with Lichess's public, unauthenticated API:
 * - polls GET /api/user/{name}/current-game (ongoing game, or the last one played);
 * - for an ongoing game (found by polling or from the embedded page URL), holds
 *   GET /api/stream/game/{id} open; its final line is the finished game, sent at game end.
 */
export class LichessGameSource implements GameSource {
  private username: string | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private readonly streams = new Map<string, AbortController>();
  /** Games with a known outcome (finished, aborted, or not the user's). */
  private readonly resolved = new Set<string>();
  /** Games whose stream already ran; never streamed twice. */
  private readonly streamed = new Set<string>();

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
    if (id) this.watchGame(id);
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
    // While a game stream is open it will report the end; skip redundant polling.
    if (this.streams.size > 0) return this.schedulePoll(interval);
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
    if (parsed.state === 'ongoing') {
      if (via === 'poll') this.watchGame(parsed.gameId);
      return;
    }
    this.resolved.add(parsed.gameId);
    if (parsed.state === 'ignored') return;
    // On startup current-game returns the last game, possibly from yesterday.
    const ageMs = Date.now() - parsed.game.endedAt;
    if (via === 'poll' && ageMs > this.config.recentGameWindowMin * 60_000) return;
    this.events.finished(parsed.game);
  }

  private watchGame(gameId: string): void {
    if (!this.username || this.resolved.has(gameId) || this.streamed.has(gameId)) return;
    if (this.streams.has(gameId) || this.streams.size >= MAX_STREAMS) return;
    const controller = new AbortController();
    this.streams.set(gameId, controller);
    this.streamed.add(gameId);
    void this.readStream(gameId, controller).finally(() => {
      this.streams.delete(gameId);
      // Seen live: if the stream closed without a final result, ask for this exact game
      // (current-game may already point at the user's next game).
      if (!controller.signal.aborted && !this.resolved.has(gameId))
        void this.resolveByExport(gameId);
      this.schedulePoll(1000);
    });
  }

  private async resolveByExport(gameId: string): Promise<void> {
    const url = `${this.config.origin}/game/export/${encodeURIComponent(gameId)}?moves=false&clocks=false&evals=false&opening=false`;
    for (const delayMs of [1000, 3000, 8000, 20_000, 60_000]) {
      await new Promise((r) => setTimeout(r, delayMs));
      if (!this.username || this.resolved.has(gameId)) return;
      try {
        const res = await this.fetchImpl(url, { headers: { Accept: 'application/json' } });
        if (res.ok) this.handleGameJson(await res.json(), 'export');
      } catch (err) {
        logger.warn(`export ${gameId} failed: ${String(err)}`);
      }
      if (this.resolved.has(gameId)) return;
    }
    logger.warn(`could not determine the result of game ${gameId}`);
    this.events.status({ status: 'error', message: `could not confirm the result of ${gameId}` });
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
