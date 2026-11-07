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
 * Second lock layer: while locked, cancel seek/challenge/rematch requests and new
 * lobby/game sockets in the Lichess session. (The first layer hides the Lichess view.)
 */
export function installRequestLock(ses: ElectronSession, isLocked: () => boolean): void {
  ses.webRequest.onBeforeRequest({ urls: URLS }, (details, callback) => {
    const cancel = isLocked() && isBlockedRequest(details.method, details.url);
    if (cancel) logger.info(`lock: blocked ${details.method} ${new URL(details.url).pathname}`);
    callback({ cancel });
  });
}
