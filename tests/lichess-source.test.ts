import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../src/core/config';
import type { FinishedGame } from '../src/shared/types';

vi.mock('../src/main/log', () => ({
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
}));
const { LichessGameSource } = await import('../src/main/lichess/source');

const raw = (name: string): string =>
  readFileSync(path.join(__dirname, 'fixtures', `${name}.json`), 'utf8').trim();
const LOSER = 'Matteo-Ioan'; // black in the UDaukhYe fixtures

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ndjson = (lines: string[]): Response => new Response(lines.map((l) => `${l}\n`).join(''));

function setup(routes: (url: string) => Response | Promise<Response>) {
  const finished: FinishedGame[] = [];
  const statuses: string[] = [];
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url.replace('https://lichess.org', '').split('?')[0] ?? url);
    return routes(url);
  }) as unknown as typeof fetch;
  const source = new LichessGameSource(
    DEFAULT_CONFIG.lichess,
    { finished: (g) => finished.push(g), status: (s) => statuses.push(s.status) },
    fetchImpl,
  );
  return { source, finished, statuses, calls };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('LichessGameSource', () => {
  it('poll finds an ongoing game, streams it, and reports the loss once', async () => {
    const t = setup((url) => {
      if (url.includes('/current-game')) return new Response(raw('stream-first'));
      if (url.includes('/api/stream/game/UDaukhYe')) {
        return ndjson([raw('stream-first'), '{"fen":"x","lm":"e2e4"}', raw('stream-final')]);
      }
      throw new Error(`unexpected ${url}`);
    });
    t.source.start(LOSER);
    await vi.advanceTimersByTimeAsync(50);
    expect(t.finished).toHaveLength(1);
    expect(t.finished[0]).toMatchObject({
      gameId: 'UDaukhYe',
      outcome: 'loss',
      userColor: 'black',
    });
    // Later polls that still see the game do not report it again or re-stream it.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(t.finished).toHaveLength(1);
    expect(t.calls.filter((c) => c.includes('/stream/')).length).toBe(1);
    t.source.stop();
  });

  it('stream closing without a result falls back to /game/export/{id}', async () => {
    let exports = 0;
    const t = setup((url) => {
      if (url.includes('/current-game')) return new Response(raw('stream-first'));
      if (url.includes('/api/stream/game/')) return ndjson([raw('stream-first')]);
      if (url.includes('/game/export/UDaukhYe')) {
        exports++;
        // First try: not final yet (delayed); second try: final.
        return exports === 1
          ? new Response(raw('stream-first'))
          : new Response(raw('stream-final'));
      }
      throw new Error(`unexpected ${url}`);
    });
    t.source.start(LOSER);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(exports).toBe(2);
    expect(t.finished.map((g) => g.outcome)).toEqual(['loss']);
    t.source.stop();
  });

  it('ignores an old finished game returned right after launch', async () => {
    const t = setup(() => new Response(raw('export-finished'))); // ended in Oct 2026
    t.source.start('DrNykterstein');
    await vi.advanceTimersByTimeAsync(50);
    expect(t.finished).toEqual([]);
    t.source.stop();
  });

  it('backs off for a minute on 429', async () => {
    const t = setup(() => json({ error: 'rate limited' }, 429));
    t.source.start(LOSER);
    await vi.advanceTimersByTimeAsync(50);
    expect(t.statuses).toContain('error');
    await vi.advanceTimersByTimeAsync(59_000);
    expect(t.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(t.calls).toHaveLength(2);
    t.source.stop();
  });

  it('keeps retrying when offline and reports it', async () => {
    const t = setup(() => {
      throw new TypeError('fetch failed');
    });
    t.source.start(LOSER);
    await vi.advanceTimersByTimeAsync(50);
    expect(t.statuses.at(-1)).toBe('error');
    await vi.advanceTimersByTimeAsync(31_000);
    expect(t.calls.length).toBeGreaterThan(1);
    t.source.stop();
  });

  it('does not stream games the user is not playing (e.g. browsing Lichess TV)', async () => {
    const t = setup((url) => {
      if (url.includes('/current-game')) return json({ error: 'Not found' }, 404);
      if (url.includes('/game/export/')) return new Response(raw('stream-final'));
      return ndjson([raw('stream-first'), raw('stream-final')]);
    });
    t.source.start('someone-else');
    t.source.noteUrl('https://lichess.org/UDaukhYe');
    await vi.advanceTimersByTimeAsync(50);
    t.source.noteUrl('https://lichess.org/UDaukhYe');
    await vi.advanceTimersByTimeAsync(50);
    expect(t.finished).toEqual([]);
    expect(t.calls.filter((c) => c.includes('UDaukhYe')).length).toBe(1);
    t.source.stop();
  });

  // A game of LOSER (black) against `opp`; no status = the stream's first line.
  const game = (id: string, extra: Record<string, unknown> = {}): string =>
    JSON.stringify({
      id,
      speed: 'blitz',
      players: { white: { user: { id: 'opp', name: 'Opp' } }, black: { user: LOSER_USER } },
      ...extra,
    });
  const LOSER_USER = { id: 'matteo-ioan', name: 'Matteo-Ioan' };
  const started = (id: string): string => game(id, { status: 'started' });
  const lost = (id: string): string =>
    game(id, { status: 'resign', winner: 'white', lastMoveAt: Date.now() });
  /** A game stream that stays open (an ongoing game). */
  const openStream = (lines: string[]): Response =>
    new Response(
      new ReadableStream({
        start(c) {
          for (const l of lines) c.enqueue(new TextEncoder().encode(`${l}\n`));
        },
      }),
    );

  it('opening an old finished game in the view does not report it', async () => {
    // Lichess replays a finished game's stream at once; its first line has no status.
    const first = JSON.stringify({ ...JSON.parse(raw('export-finished')), status: undefined });
    const t = setup((url) => {
      if (url.includes('/current-game')) return json({ error: 'Not found' }, 404);
      if (url.includes('/api/stream/game/HqjDTU4A')) {
        return ndjson([first, '{"fen":"x","lm":"d2d4"}', raw('export-finished')]);
      }
      if (url.includes('/game/export/HqjDTU4A')) return new Response(raw('export-finished'));
      return json({ error: 'Not found' }, 404);
    });
    t.source.start('Night-King96');
    t.source.noteUrl('https://lichess.org/HqjDTU4A');
    t.source.noteUrl('https://lichess.org/HqjDTU4A/black');
    t.source.noteUrl('https://lichess.org/features');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(t.finished).toEqual([]);
    expect(t.calls.filter((c) => c.includes('/features')).length).toBe(0);
    t.source.stop();
  });

  it('a live loss is detected while two ongoing correspondence games hold the streams', async () => {
    const t = setup((url) => {
      const now = Date.now() - start;
      if (url.includes('/current-game')) {
        if (now < 20_000) return new Response(started('CORR0001'));
        return new Response(started(now < 60_000 ? 'LIVE0001' : 'LIVE0002'));
      }
      if (url.includes('/api/stream/game/CORR')) return openStream([game('CORR')]);
      if (url.includes('/api/stream/game/LIVE')) return openStream([game('LIVE')]);
      if (url.includes('/game/export/CORR0002')) return new Response(started('CORR0002'));
      if (url.includes('/game/export/LIVE0001')) {
        return new Response(now < 55_000 ? started('LIVE0001') : lost('LIVE0001'));
      }
      throw new Error(`unexpected ${url}`);
    });
    const start = Date.now();
    t.source.start(LOSER);
    await vi.advanceTimersByTimeAsync(50);
    t.source.noteUrl('https://lichess.org/CORR0002');
    await vi.advanceTimersByTimeAsync(180_000);
    expect(t.finished.map((g) => [g.gameId, g.outcome])).toEqual([['LIVE0001', 'loss']]);
    t.source.stop();
  });

  it('a stream that drops mid-game still resolves after the next game starts', async () => {
    const t = setup((url) => {
      const now = Date.now() - start;
      if (url.includes('/current-game')) {
        return new Response(started(now < 30_000 ? 'AAAA0001' : 'BBBB0001'));
      }
      if (url.includes('/api/stream/game/AAAA0001')) return ndjson([game('AAAA0001')]);
      if (url.includes('/api/stream/game/BBBB0001')) return openStream([game('BBBB0001')]);
      if (url.includes('/game/export/AAAA0001')) {
        return new Response(now < 200_000 ? started('AAAA0001') : lost('AAAA0001'));
      }
      throw new Error(`unexpected ${url}`);
    });
    const start = Date.now();
    t.source.start(LOSER);
    await vi.advanceTimersByTimeAsync(400_000);
    expect(t.finished.map((g) => [g.gameId, g.outcome])).toEqual([['AAAA0001', 'loss']]);
    // Rate limits: one current-game poll per 10 s, exports backed off to at most one a minute.
    expect(t.calls.filter((c) => c.includes('/current-game')).length).toBeLessThanOrEqual(45);
    expect(t.calls.filter((c) => c.includes('/game/export/')).length).toBeLessThanOrEqual(12);
    t.source.stop();
  });

  it('live wins, draws and aborts are reported as before', async () => {
    const finals: Record<string, string> = {
      WINS0001: game('WINS0001', { status: 'mate', winner: 'black' }),
      DRAW0001: game('DRAW0001', { status: 'draw' }),
      ABRT0001: game('ABRT0001', { status: 'aborted' }),
    };
    const ids = Object.keys(finals);
    const t = setup((url) => {
      const i = Math.floor((Date.now() - start) / 30_000);
      if (url.includes('/current-game')) return new Response(started(ids[i] ?? 'ZZZZ0001'));
      const id = /stream\/game\/(\w+)/.exec(url)?.[1] ?? '';
      if (finals[id]) return ndjson([game(id), finals[id]]);
      return openStream([game(id)]);
    });
    const start = Date.now();
    t.source.start(LOSER);
    await vi.advanceTimersByTimeAsync(100_000);
    expect(t.finished.map((g) => [g.gameId, g.outcome])).toEqual([
      ['WINS0001', 'win'],
      ['DRAW0001', 'draw'],
    ]);
    t.source.stop();
  });
});
