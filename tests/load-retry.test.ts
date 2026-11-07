import { describe, expect, it } from 'vitest';
import { isRetryableLoadFailure, retryDelayMs } from '../src/core/load-retry';

describe('isRetryableLoadFailure', () => {
  it('retries main-frame network failures', () => {
    expect(isRetryableLoadFailure(-7, true)).toBe(true); // ERR_TIMED_OUT, seen live
    expect(isRetryableLoadFailure(-106, true)).toBe(true); // ERR_INTERNET_DISCONNECTED
    expect(isRetryableLoadFailure(-105, true)).toBe(true); // ERR_NAME_NOT_RESOLVED
  });

  it('ignores aborted navigations, lock cancellations and subframes', () => {
    expect(isRetryableLoadFailure(-3, true)).toBe(false);
    expect(isRetryableLoadFailure(-20, true)).toBe(false);
    expect(isRetryableLoadFailure(-7, false)).toBe(false);
  });
});

describe('retryDelayMs', () => {
  it('backs off 2s, 5s, 10s, then every 30s', () => {
    expect([1, 2, 3, 4, 5, 50].map(retryDelayMs)).toEqual([2000, 5000, 10000, 30000, 30000, 30000]);
  });
});
