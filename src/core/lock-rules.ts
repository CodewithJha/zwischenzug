/**
 * Requests to cancel in the Lichess session while a cooldown is active. This is defense in
 * depth: the primary lock hides the Lichess view entirely. Paths are from lila's routes and
 * are best-effort; Lichess can change them.
 */
const BLOCKED_POST = [
  /^\/setup\/(hook|friend|ai)\b/, // create a lobby seek, challenge a friend, play the computer
  /^\/challenge\/[^/]+\/accept\b/,
  /^\/api\/challenge\b/,
  /^\/api\/board\/seek\b/,
  /^\/(api\/)?(tournament|swiss)\/[^/]+\/join\b/,
  /\/rematch\b/,
];

const BLOCKED_SOCKET = [
  /^\/lobby\/socket\b/, // quick pairing and seeks run over the lobby socket
  /^\/play\//, // player game sockets carry rematch offers
];

export function isBlockedRequest(method: string, rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  const host = url.hostname;
  if (host !== 'lichess.org' && !host.endsWith('.lichess.org')) return false;
  if (url.protocol === 'wss:' || url.protocol === 'ws:') {
    return BLOCKED_SOCKET.some((re) => re.test(url.pathname));
  }
  return method.toUpperCase() === 'POST' && BLOCKED_POST.some((re) => re.test(url.pathname));
}
