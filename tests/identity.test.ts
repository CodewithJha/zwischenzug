import { describe, expect, it } from 'vitest';
import {
  identityView,
  loginSessionId,
  parseAccountInfo,
  playBlocked,
  type IdentityObservation,
} from '../src/core/identity';

const SIGNED_IN = (username: string): IdentityObservation => ({ kind: 'signed-in', username });
/** Real lila `/account/info` shape (lichobileInfo + extras). */
const accountInfo = (username: string): unknown => ({
  id: username.toLowerCase(),
  username,
  prefs: {},
  nowPlaying: [],
  nbChallenges: 0,
  online: true,
});

/** What the request lock decides for a sequence of observations, cooldown off. */
const blockedAfter = (expected: string, ...obs: IdentityObservation[]): boolean[] =>
  obs.map((o) => playBlocked(false, identityView(o, expected)));

describe('parseAccountInfo', () => {
  it('reads the signed-in user', () => {
    expect(parseAccountInfo(200, accountInfo('CodeWithJha'))).toEqual(SIGNED_IN('CodeWithJha'));
  });

  it('treats 401 (seen live when logged out) as signed out', () => {
    expect(parseAccountInfo(401, { error: 'Login required' })).toEqual({ kind: 'signed-out' });
  });

  it.each([
    [403, null], // Cloudflare challenge page
    [429, null],
    [500, null],
    [303, null], // redirect to /login
    [200, null], // non-JSON body
    [200, { id: 'x' }],
    [200, { username: 42 }],
    [200, { username: '<script>' }],
    [200, ['codewithjha']],
  ])('never treats HTTP %s %j as a sign-in', (status, body) => {
    expect(parseAccountInfo(status, body).kind).toBe('error');
  });
});

describe('identityView / playBlocked', () => {
  it('allows play only for a verified sign-in as the configured account', () => {
    const v = identityView(SIGNED_IN('codewithjha'), 'codewithjha');
    expect(v.status).toBe('verified');
    expect(playBlocked(false, v)).toBe(false);
  });

  it('matches usernames case-insensitively', () => {
    expect(identityView(SIGNED_IN('CodeWithJha'), 'codewithjha').status).toBe('verified');
    expect(identityView(SIGNED_IN('codewithjha'), 'CODEWITHJHA').status).toBe('verified');
  });

  it('blocks while logged out, with a sign-in message', () => {
    const v = identityView({ kind: 'signed-out' }, 'codewithjha');
    expect(v.status).toBe('signed-out');
    expect(v.message).toBe('Sign in to Lichess as @codewithjha to play.');
    expect(playBlocked(false, v)).toBe(true);
  });

  it('blocks a different account and names both', () => {
    const v = identityView(SIGNED_IN('someoneElse'), 'codewithjha');
    expect(v.status).toBe('wrong-account');
    expect(v.signedInAs).toBe('someoneElse');
    expect(v.message).toContain('@someoneElse');
    expect(v.message).toContain('@codewithjha');
    expect(playBlocked(false, v)).toBe(true);
  });

  it('does not treat a prefix or similar name as a match', () => {
    expect(identityView(SIGNED_IN('codewithjha2'), 'codewithjha').status).toBe('wrong-account');
    expect(identityView(SIGNED_IN('codewith'), 'codewithjha').status).toBe('wrong-account');
  });

  it('blocks while the first check is pending', () => {
    expect(blockedAfter('codewithjha', { kind: 'checking' })).toEqual([true]);
  });

  it('fails closed on a network error and recovers on the next good answer', () => {
    const error: IdentityObservation = { kind: 'error', message: 'cannot reach Lichess' };
    expect(identityView(error, 'codewithjha').message).toContain('cannot reach Lichess');
    expect(
      blockedAfter('codewithjha', SIGNED_IN('codewithjha'), error, SIGNED_IN('codewithjha')),
    ).toEqual([false, true, false]);
  });

  it('blocks again when the session expires mid-session', () => {
    expect(
      blockedAfter(
        'codewithjha',
        SIGNED_IN('codewithjha'),
        { kind: 'checking' },
        {
          kind: 'signed-out',
        },
      ),
    ).toEqual([false, true, true]);
  });

  it('keeps play blocked after a cooldown if the account was switched during it', () => {
    const switched = identityView(SIGNED_IN('someoneElse'), 'codewithjha');
    expect(playBlocked(true, identityView(SIGNED_IN('codewithjha'), 'codewithjha'))).toBe(true);
    expect(playBlocked(true, switched)).toBe(true); // switched during the cooldown
    expect(playBlocked(false, switched)).toBe(true); // cooldown over, still the wrong account
    expect(playBlocked(false, identityView(SIGNED_IN('CodeWithJha'), 'codewithjha'))).toBe(false);
  });

  it('never verifies without a configured username', () => {
    expect(identityView(SIGNED_IN('codewithjha'), null).status).toBe('wrong-account');
  });
});

describe('loginSessionId', () => {
  it('is absent in a logged-out lila2 cookie (seen live: only sid)', () => {
    expect(loginSessionId('abc123-sid=Xy9')).toBeNull();
    expect(loginSessionId(null)).toBeNull();
  });

  it('reads the login session id, URL-encoded or not', () => {
    expect(loginSessionId('abc123-sid=Xy9&sessionId=S3ss10n')).toBe('S3ss10n');
    expect(loginSessionId(encodeURIComponent('abc-sessionId=S1&sid=Xy9'))).toBe('S1');
  });

  it('survives malformed encoding', () => {
    expect(loginSessionId('%E0%A4%A-sessionId=S1')).toBe('S1');
  });
});
