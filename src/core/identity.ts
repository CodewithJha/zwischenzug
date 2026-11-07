import type { IdentityView } from '../shared/types';

/** What the embedded Lichess session last told us about who is signed in. */
export type IdentityObservation =
  | { kind: 'checking' }
  | { kind: 'signed-in'; username: string }
  | { kind: 'signed-out' }
  | { kind: 'error'; message: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Interprets lichess.org `GET /account/info` (session-cookie auth, JSON). Verified live:
 * signed out -> 401 `{"error":"Login required"}`. Signed in -> 200 `{id, username, ...}`
 * (lila `Account.info`). Anything else is an error, never a sign-in.
 */
export function parseAccountInfo(httpStatus: number, body: unknown): IdentityObservation {
  if (httpStatus === 401) return { kind: 'signed-out' };
  if (httpStatus !== 200) return { kind: 'error', message: `Lichess answered HTTP ${httpStatus}` };
  const name = isRecord(body) ? body.username : undefined;
  if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]{2,30}$/.test(name)) {
    return { kind: 'error', message: 'unexpected answer from Lichess' };
  }
  return { kind: 'signed-in', username: name };
}

/**
 * The login session id inside Lichess's `lila2` cookie (absent while signed out). Only used
 * as a hint that the sign-in changed and must be checked again, never as the identity.
 */
export function loginSessionId(cookieValue: string | null): string | null {
  if (!cookieValue) return null;
  let value = cookieValue;
  try {
    value = decodeURIComponent(cookieValue);
  } catch {
    // keep the raw value
  }
  return /(?:^|[-&])sessionId=([^&]+)/.exec(value)?.[1] ?? null;
}

/** Play is allowed only for a verified sign-in as the configured account. */
export function identityView(obs: IdentityObservation, expected: string | null): IdentityView {
  const want = expected ? `@${expected}` : 'your account';
  switch (obs.kind) {
    case 'checking':
      return { status: 'checking', signedInAs: null, message: 'Checking your Lichess sign-in...' };
    case 'signed-out':
      return {
        status: 'signed-out',
        signedInAs: null,
        message: `Sign in to Lichess as ${want} to play.`,
      };
    case 'error':
      return {
        status: 'error',
        signedInAs: null,
        message: `Could not check your Lichess sign-in (${obs.message}). Games stay blocked; retrying.`,
      };
    case 'signed-in':
      if (expected && obs.username.toLowerCase() === expected.toLowerCase()) {
        return {
          status: 'verified',
          signedInAs: obs.username,
          message: `Signed in as @${obs.username}`,
        };
      }
      return {
        status: 'wrong-account',
        signedInAs: obs.username,
        message: `Signed in as @${obs.username}. Sign out and sign in to Lichess as ${want} to play.`,
      };
  }
}

/** Whether the request lock must block play: during a cooldown, or without a verified sign-in. */
export function playBlocked(locked: boolean, identity: IdentityView): boolean {
  return locked || identity.status !== 'verified';
}
