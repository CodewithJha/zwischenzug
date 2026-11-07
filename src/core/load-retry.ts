/** Chromium net error codes that are not "lichess.org is unreachable". */
const ERR_ABORTED = -3; // superseded by another navigation or a redirect
const ERR_BLOCKED_BY_CLIENT = -20; // cancelled by the request lock

/** Whether a failed load should show the "couldn't reach" notice and be retried. */
export function isRetryableLoadFailure(errorCode: number, isMainFrame: boolean): boolean {
  return isMainFrame && errorCode !== ERR_ABORTED && errorCode !== ERR_BLOCKED_BY_CLIENT;
}

const BACKOFF_MS = [2000, 5000, 10000];

/** Delay before the next retry after `failures` failed loads in a row (1 = first failure). */
export function retryDelayMs(failures: number): number {
  return BACKOFF_MS[failures - 1] ?? 30000;
}
