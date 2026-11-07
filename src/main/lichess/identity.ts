import type { Session as ElectronSession } from 'electron';
import { loginSessionId, parseAccountInfo, type IdentityObservation } from '../../core/identity';
import { logger } from '../log';

const CHECK_INTERVAL_MS = 60_000;
const RETRY_MS = 10_000;
const DEBOUNCE_MS = 300;
const TIMEOUT_MS = 10_000;

/**
 * Asks lichess.org who is signed in to the embedded Lichess session, using that session's
 * own cookies (no password, no token). Re-checks when the login cookie changes, when asked
 * (navigation), and every minute; retries sooner after errors.
 */
export function watchLichessIdentity(
  ses: ElectronSession,
  origin: string,
  report: (obs: IdentityObservation) => void,
): { recheck(): void } {
  let seq = 0;
  let timer: NodeJS.Timeout | null = null;
  let lastSessionId: string | null | undefined;

  const check = async (): Promise<void> => {
    const id = ++seq;
    let obs: IdentityObservation;
    try {
      const res = await ses.fetch(`${origin}/account/info`, {
        headers: { Accept: 'application/json' },
        credentials: 'include',
        // Lichess marks this response cacheable for 20 s; a cached answer could outlive a logout.
        cache: 'no-store',
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const json = (res.headers.get('content-type') ?? '').includes('json');
      obs = parseAccountInfo(res.status, json ? await res.json().catch(() => null) : null);
    } catch (err) {
      logger.warn(`lichess identity check failed: ${String(err)}`);
      obs = { kind: 'error', message: 'cannot reach Lichess' };
    }
    if (id !== seq) return; // a newer check or a sign-in change superseded this answer
    logger.info(`lichess identity: ${obs.kind}`);
    report(obs);
    schedule(obs.kind === 'error' ? RETRY_MS : CHECK_INTERVAL_MS);
  };

  const schedule = (ms: number): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void check(), ms);
  };

  ses.cookies.on('changed', (_e, cookie, _cause, removed) => {
    if (cookie.name !== 'lila2' || !/(^|\.)lichess\.org$/.test(cookie.domain ?? '')) return;
    const sessionId = removed ? null : loginSessionId(cookie.value);
    if (sessionId === lastSessionId) return;
    lastSessionId = sessionId;
    // Sign-in, sign-out or account switch: block play until the new identity is confirmed.
    seq++;
    report({ kind: 'checking' });
    schedule(DEBOUNCE_MS);
  });

  void ses.cookies
    .get({ name: 'lila2' })
    .then((cookies) => {
      lastSessionId ??= loginSessionId(cookies[0]?.value ?? null);
    })
    .catch(() => undefined);
  report({ kind: 'checking' });
  schedule(0);
  return { recheck: () => schedule(DEBOUNCE_MS) };
}
