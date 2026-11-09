/** True for https URLs on lichess.org or one of its subdomains. */
export function isLichessUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return url.hostname === 'lichess.org' || url.hostname.endsWith('.lichess.org');
}

/** Eight-letter site sections that would otherwise look like game ids. */
const RESERVED_PATHS = new Set([
  'analysis',
  'training',
  'practice',
  'streamer',
  'tutorial',
  'calendar',
  'insights',
  'features',
  'timeline',
  'download',
]);

/**
 * Extracts a game id from a Lichess game URL.
 * Game ids are 8 alphanumerics; player URLs append a 4-char player id (12 total),
 * optionally followed by /white or /black. Lichess also serves games under /game/{id}.
 */
export function gameIdFromUrl(raw: string): string | null {
  if (!isLichessUrl(raw)) return null;
  const path = new URL(raw).pathname;
  const match = /^\/(?:game\/)?([a-zA-Z0-9]{8})(?:[a-zA-Z0-9]{4})?(?:\/(?:white|black))?\/?$/.exec(
    path,
  );
  if (!match?.[1]) return null;
  if (RESERVED_PATHS.has(match[1].toLowerCase())) return null;
  return match[1];
}
