import { describe, expect, it } from 'vitest';
import { gameIdFromUrl, isLichessUrl } from '../src/core/lichess-url';

describe('isLichessUrl', () => {
  it.each([
    ['https://lichess.org', true],
    ['https://lichess.org/abcdEFGH', true],
    ['https://en.lichess.org/login', true],
    ['http://lichess.org', false],
    ['https://lichess.org.evil.com', false],
    ['https://evil-lichess.org', false],
    ['file:///etc/passwd', false],
    ['not a url', false],
  ])('%s -> %s', (url, expected) => {
    expect(isLichessUrl(url)).toBe(expected);
  });
});

describe('gameIdFromUrl', () => {
  it.each([
    ['https://lichess.org/HqjDTU4A', 'HqjDTU4A'],
    ['https://lichess.org/HqjDTU4Abcde', 'HqjDTU4A'],
    ['https://lichess.org/HqjDTU4A/black', 'HqjDTU4A'],
    ['https://lichess.org/HqjDTU4A/', 'HqjDTU4A'],
    ['https://lichess.org/', null],
    ['https://lichess.org/analysis', null],
    ['https://lichess.org/training', null],
    ['https://lichess.org/@/DrNykterstein', null],
    ['https://lichess.org/tournament/8lVvEuuX', null],
    ['https://example.com/HqjDTU4A', null],
  ])('%s -> %s', (url, expected) => {
    expect(gameIdFromUrl(url)).toBe(expected);
  });
});
