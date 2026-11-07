import type { Session as ElectronSession } from 'electron';
import { isBlockedRequest } from '../../core/lock-rules';
import { logger } from '../log';

const URLS = [
  'https://lichess.org/*',
  'https://*.lichess.org/*',
  'wss://lichess.org/*',
  'wss://*.lichess.org/*',
];

/**
 * Cancels seek/challenge/rematch requests and new lobby/game sockets in the Lichess session
 * while `isBlocked()`: during a cooldown (second layer; the first hides the Lichess view) and
 * while the Lichess sign-in is not verified as the configured account (the only layer then,
 * so the user can still sign in and browse).
 */
export function installRequestLock(ses: ElectronSession, isBlocked: () => boolean): void {
  ses.webRequest.onBeforeRequest({ urls: URLS }, (details, callback) => {
    const cancel = isBlocked() && isBlockedRequest(details.method, details.url);
    // Debug level: Lichess retries its lobby socket every few seconds while locked.
    if (cancel) logger.debug(`lock: blocked ${details.method} ${new URL(details.url).pathname}`);
    callback({ cancel });
  });
}
