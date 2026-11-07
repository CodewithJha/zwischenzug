import type { Color, FinishedGame } from '../shared/types';

export type ParsedGame =
  | { gameId: string; state: 'ongoing' }
  /** Finished but no result for this user: aborted, never started, or the user did not play. */
  | { gameId: string; state: 'ignored'; why: string }
  | { gameId: string; state: 'finished'; game: FinishedGame };

const ONGOING = new Set(['created', 'started']);
const NO_RESULT = new Set(['aborted', 'noStart', 'unknownFinish']);

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Export endpoints send `status: "resign"`; the game stream sends `status: {id, name}`. */
function statusName(raw: unknown): string | null {
  if (typeof raw === 'string') return raw;
  if (isRec(raw) && typeof raw.name === 'string') return raw.name;
  return null;
}

function playerId(players: Rec, color: Color): string | null {
  const p = players[color];
  if (!isRec(p) || !isRec(p.user)) return null;
  const id = p.user.id ?? p.user.name;
  return typeof id === 'string' ? id.toLowerCase() : null;
}

/**
 * Interprets a Lichess game object (from /api/user/{u}/current-game, /game/export/{id} or
 * the final line of /api/stream/game/{id}) from `username`'s point of view.
 * Returns null for objects that are not game descriptions (e.g. stream move lines).
 */
export function parseGame(json: unknown, username: string, now: number): ParsedGame | null {
  if (!isRec(json) || typeof json.id !== 'string' || !isRec(json.players)) return null;
  const gameId = json.id;
  const me = username.toLowerCase();
  const userColor: Color | null =
    playerId(json.players, 'white') === me
      ? 'white'
      : playerId(json.players, 'black') === me
        ? 'black'
        : null;
  if (!userColor) return { gameId, state: 'ignored', why: 'not a participant' };

  const status = statusName(json.status);
  // The first stream line carries no status at all: the game is in progress.
  if (status === null || ONGOING.has(status)) return { gameId, state: 'ongoing' };
  if (NO_RESULT.has(status)) return { gameId, state: 'ignored', why: status };

  const winner = json.winner === 'white' || json.winner === 'black' ? json.winner : null;
  const outcome = winner === null ? 'draw' : winner === userColor ? 'win' : 'loss';
  const speed = typeof json.speed === 'string' ? json.speed : null;
  const endedAt = typeof json.lastMoveAt === 'number' ? json.lastMoveAt : now;
  return { gameId, state: 'finished', game: { gameId, outcome, userColor, speed, endedAt } };
}
