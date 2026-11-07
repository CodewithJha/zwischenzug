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
      return ndjson([raw('stream-first'), raw('stream-final')]);
    });
    t.source.start('someone-else');
    t.source.noteUrl('https://lichess.org/UDaukhYe');
    await vi.advanceTimersByTimeAsync(50);
    t.source.noteUrl('https://lichess.org/UDaukhYe');
    await vi.advanceTimersByTimeAsync(50);
    expect(t.finished).toEqual([]);
    expect(t.calls.filter((c) => c.includes('/stream/')).length).toBe(1);
    t.source.stop();
  });
});
