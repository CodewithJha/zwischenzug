import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseGame } from '../src/core/lichess-game';
import { ndjsonSplitter } from '../src/core/ndjson';

// Real responses captured from lichess.org on 2026-11-07 (see tests/fixtures).
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(path.join(__dirname, 'fixtures', `${name}.json`), 'utf8'));
const NOW = 1_794_049_000_000;

describe('parseGame with real Lichess payloads', () => {
  it('first line of /api/stream/game/{id} is an ongoing game', () => {
    expect(parseGame(fixture('stream-first'), 'Matteo-Ioan', NOW)).toEqual({
      gameId: 'UDaukhYe',
      state: 'ongoing',
    });
  });

  it('final stream line (status object) -> loss for the loser, win for the winner', () => {
    const final = fixture('stream-final');
    expect(parseGame(final, 'Matteo-Ioan', NOW)).toEqual({
      gameId: 'UDaukhYe',
      state: 'finished',
      game: {
        gameId: 'UDaukhYe',
        outcome: 'loss',
        userColor: 'black',
        speed: 'ultraBullet',
        endedAt: NOW,
      },
    });
    const win = parseGame(final, 'witzboldig', NOW);
    expect(win?.state === 'finished' && win.game.outcome).toBe('win');
  });

  it('export / current-game JSON (status string) uses lastMoveAt as end time', () => {
    const r = parseGame(fixture('export-finished'), 'drnykterstein', NOW);
    expect(r).toEqual({
      gameId: 'HqjDTU4A',
      state: 'finished',
      game: {
        gameId: 'HqjDTU4A',
        outcome: 'win',
        userColor: 'white',
        speed: 'blitz',
        endedAt: 1792001402854,
      },
    });
  });

  it('ignores games the user did not play', () => {
    expect(parseGame(fixture('stream-final'), 'someone-else', NOW)).toMatchObject({
      state: 'ignored',
      why: 'not a participant',
    });
  });
});

describe('parseGame edge cases', () => {
  const game = (extra: Record<string, unknown>) => ({
    id: 'abcdefgh',
    players: { white: { user: { id: 'me' } }, black: { user: { name: 'Them' } } },
    ...extra,
  });

  it.each(['draw', 'stalemate', 'insufficientMaterialClaim'])(
    '%s without winner is a draw',
    (status) => {
      const r = parseGame(game({ status }), 'ME', NOW);
      expect(r?.state === 'finished' && r.game.outcome).toBe('draw');
    },
  );

  it.each(['aborted', 'noStart', 'unknownFinish'])('%s is ignored (no cooldown)', (status) => {
    expect(parseGame(game({ status }), 'me', NOW)?.state).toBe('ignored');
  });

  it.each(['created', 'started'])('%s is ongoing', (status) => {
    expect(parseGame(game({ status }), 'me', NOW)?.state).toBe('ongoing');
  });

  it('matches black by user name when id is missing', () => {
    const r = parseGame(game({ status: 'mate', winner: 'white' }), 'them', NOW);
    expect(r?.state === 'finished' && r.game).toMatchObject({
      outcome: 'loss',
      userColor: 'black',
    });
  });

  it('anonymous opponents (no user object) do not break parsing', () => {
    const r = parseGame(
      {
        id: 'abcdefgh',
        status: 'resign',
        winner: 'black',
        players: { white: { user: { id: 'me' } }, black: {} },
      },
      'me',
      NOW,
    );
    expect(r?.state === 'finished' && r.game.outcome).toBe('loss');
  });

  it('returns null for non-game lines', () => {
    expect(parseGame({ fen: 'x', lm: 'e2e4' }, 'me', NOW)).toBeNull();
    expect(parseGame(null, 'me', NOW)).toBeNull();
  });
});

describe('ndjsonSplitter', () => {
  it('handles values split across chunks, blank keep-alives and bad lines', () => {
    const out: unknown[] = [];
    const push = ndjsonSplitter((v) => out.push(v));
    push('{"a":1}\n\n{"b"');
    push(':2}\nnot json\n{"c":3}');
    expect(out).toEqual([{ a: 1 }, { b: 2 }]);
    push('\n');
    expect(out).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });
});
