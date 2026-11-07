import type { AppSnapshot, FinishedGame } from '../shared/types';

export interface GameSourceEvents {
  /** A game the user played has finished. May fire more than once per game; callers dedupe. */
  finished(game: FinishedGame): void;
  status(status: AppSnapshot['lichess']): void;
}

/** Where finished games come from. Lichess today; Chess.com is the planned second source. */
export interface GameSource {
  start(username: string): void;
  stop(): void;
  /** Hint: the embedded site navigated to this URL (lets the source react faster). */
  noteUrl(url: string): void;
}
