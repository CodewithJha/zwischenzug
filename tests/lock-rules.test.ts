import { describe, expect, it } from 'vitest';
import { isBlockedRequest } from '../src/core/lock-rules';

describe('isBlockedRequest', () => {
  it.each([
    ['POST', 'https://lichess.org/setup/hook/abc123?sri=x'],
    ['POST', 'https://lichess.org/setup/friend?user=bob'],
    ['POST', 'https://lichess.org/setup/ai'],
    ['POST', 'https://lichess.org/challenge/AbCd1234/accept'],
    ['POST', 'https://lichess.org/api/challenge/bob'],
    ['POST', 'https://lichess.org/api/board/seek'],
    ['POST', 'https://lichess.org/tournament/8lVvEuuX/join'],
    ['POST', 'https://lichess.org/swiss/abcd1234/join'],
    ['POST', 'https://lichess.org/HqjDTU4Aabcd/rematch'],
    ['GET', 'wss://socket3.lichess.org/lobby/socket/v5?sri=x'],
    ['GET', 'wss://socket1.lichess.org/play/HqjDTU4Aabcd/v6?sri=x'],
  ])('blocks %s %s', (method, url) => {
    expect(isBlockedRequest(method, url)).toBe(true);
  });

  it.each([
    ['GET', 'https://lichess.org/'],
    ['GET', 'https://lichess.org/setup/hook'], // only POST creates a seek
    ['GET', 'https://lichess.org/HqjDTU4A'], // reviewing the lost game is fine
    ['POST', 'https://lichess.org/login'],
    ['GET', 'wss://socket1.lichess.org/watch/HqjDTU4A/white/v6'],
    ['GET', 'wss://socket1.lichess.org/analysis/socket/v5'],
    ['POST', 'https://example.com/setup/hook/x'],
    ['POST', 'not a url'],
  ])('allows %s %s', (method, url) => {
    expect(isBlockedRequest(method, url)).toBe(false);
  });
});
