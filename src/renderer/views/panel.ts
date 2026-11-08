import type { AppSnapshot, GameLogEntry, IdentityView } from '../../shared/types';
import { statusLine, type DotKind } from '../components';
import { h, zz, type View } from '../dom';
import { capitalize, describeCooldown, formatBpm, formatWhen } from '../format';
import { apiKeyForm } from './api-key';

const NO_GAMES_YET = 'no games found yet for this account';

function logRow(g: GameLogEntry, now: number): HTMLElement {
  const streak = g.outcome === 'loss' && (g.consecutiveLosses ?? 0) > 1;
  const detail = g.cooldown
    ? describeCooldown(g.cooldown)
    : g.outcome === 'loss'
      ? 'Cooldown running'
      : '';
  return h(
    'li',
    { class: 'log-row', 'data-outcome': g.outcome },
    h(
      'p',
      { class: 'log-line' },
      h('span', { class: 'log-outcome' }, capitalize(g.outcome)),
      g.speed ? h('span', { class: 'log-speed' }, capitalize(g.speed)) : null,
      streak ? h('span', { class: 'log-speed' }, `${g.consecutiveLosses} in a row`) : null,
      h(
        'time',
        { class: 'log-when', datetime: new Date(g.endedAt).toISOString() },
        formatWhen(g.endedAt, now),
      ),
    ),
    detail ? h('p', { class: 'log-detail' }, detail) : null,
  );
}

/** Identity card: who is signed in to the embedded Lichess, and whether games are allowed. */
function identityCopy(id: IdentityView, username: string): [DotKind, string, string] {
  const who = `@${username}`;
  switch (id.status) {
    case 'verified':
      return ['live', `@${id.signedInAs ?? username}`, 'Signed in · games allowed'];
    case 'checking':
      return ['idle', who, 'Checking sign-in…'];
    case 'signed-out':
      return ['warn', who, 'Not signed in · games locked'];
    case 'wrong-account':
      return ['warn', who, `Signed in as @${id.signedInAs ?? '?'} · games locked`];
    case 'error':
      return ['warn', who, 'Can’t check sign-in · games locked'];
  }
}

/** Text for the bar above Lichess while games are not allowed. */
function barCopy(id: IdentityView): string {
  if (id.status === 'error')
    return 'Can’t check your Lichess sign-in. Games stay locked; retrying.';
  return id.message.replace(/\.\.\.$/, '…');
}

function feedCopy(s: AppSnapshot['lichess']): string {
  if (s.status === 'watching')
    return s.message === NO_GAMES_YET ? 'Watching · no games yet' : 'Watching';
  if (s.status === 'idle') return 'Not started';
  return capitalize(s.message ?? 'Unavailable');
}

function fact(term: string, ...value: (Node | string)[]): HTMLElement[] {
  return [h('dt', {}, term), h('dd', {}, ...value)];
}

/** Side panel shown next to Lichess while playing: status, game log, settings, delete-all. */
export function panelView(): View {
  const identity = statusLine();
  identity.el.classList.add('panel-identity');

  const feedDot = h('span', { class: 'dot warn', 'aria-hidden': 'true' });
  const feed = h('span');
  const mode = h('span');
  const baseline = h('span', { class: 'num' });
  const losses = h('span', { class: 'num' });
  const recalibrate = h('button', { class: 'quiet', onclick: () => void zz().recalibrate() });
  const facts = h(
    'dl',
    { class: 'facts' },
    ...fact('Game feed', h('span', { class: 'with-dot' }, feedDot, feed)),
    ...fact('Mode', mode),
    ...fact('Baseline', baseline, recalibrate),
    ...fact('Losses in a row', losses),
  );
  const notices = h('div', { class: 'notices' });

  const logList = h('ol', { class: 'log' });
  const logMessage = h('p', { class: 'message', role: 'status' });
  const refreshLog = async (): Promise<void> => {
    const games = await zz().getLog();
    const now = Date.now();
    logList.replaceChildren(
      ...(games.length
        ? games.map((g) => logRow(g, now))
        : [h('li', { class: 'log-empty' }, 'Finished Lichess games appear here.')]),
    );
  };
  const exportLog = async (format: 'csv' | 'json'): Promise<void> => {
    const res = await zz().exportLog(format);
    logMessage.textContent = res.ok ? 'Game log exported.' : res.error;
  };

  const key = apiKeyForm();

  let deleteArmed = false;
  const deleteMessage = h('p', { class: 'message', role: 'status' });
  const deleteBtn = h('button', { class: 'quiet danger' }, 'Delete all my data');
  deleteBtn.addEventListener('click', async () => {
    if (!deleteArmed) {
      deleteArmed = true;
      deleteBtn.classList.add('armed');
      deleteBtn.textContent = 'Click again to delete log, baseline and consent';
      return;
    }
    const res = await zz().deleteAllData();
    deleteMessage.textContent = res.ok ? 'All local data deleted.' : res.error;
  });

  // Sits above the Lichess view (main leaves room for it) while play is not allowed.
  const barDot = h('span', { class: 'dot warn', 'aria-hidden': 'true' });
  const barText = h('span', { class: 'signin-text' });
  const loginBtn = h(
    'button',
    { class: 'primary', onclick: () => void zz().openLichessLogin() },
    'Sign in to Lichess',
  );
  const bar = h('div', { class: 'signin-bar', role: 'status' }, barDot, barText, loginBtn);

  // Fills the Lichess area (main hides the view) while lichess.org fails to load.
  // The ticking countdown is hidden from screen readers so it is not announced every second.
  const countdownText = h('span', { class: 'num', 'aria-hidden': 'true' });
  const retry = (): void => void zz().retryLichess();
  const offline = h(
    'div',
    { class: 'offline-notice', role: 'status' },
    h('h2', {}, 'Can’t reach lichess.org'),
    h('p', { class: 'message' }, 'Check your connection. ', countdownText),
    h('button', { class: 'primary', onclick: retry }, 'Retry now'),
  );
  let retryAt: number | null = null;
  const showCountdown = (): void => {
    if (retryAt === null) return;
    const sec = Math.ceil((retryAt - Date.now()) / 1000);
    countdownText.textContent = sec > 0 ? `Retrying in ${sec} s` : 'Retrying…';
  };
  const countdown = setInterval(showCountdown, 1000);
  const onOnline = (): void => {
    if (retryAt !== null) retry();
  };
  window.addEventListener('online', onOnline);

  const el = h(
    'aside',
    { class: 'panel', 'aria-label': 'Zwischenzug' },
    bar,
    offline,
    h('header', { class: 'panel-head' }, h('span', { class: 'wordmark' }, 'Zwischenzug')),
    h('section', { class: 'panel-section' }, identity.el, facts, notices),
    h(
      'section',
      { class: 'panel-section', 'aria-labelledby': 'panel-log' },
      h(
        'div',
        { class: 'section-head' },
        h('h2', { id: 'panel-log' }, 'Games'),
        h(
          'div',
          { class: 'actions' },
          h(
            'button',
            {
              class: 'quiet',
              'aria-label': 'Export game log as CSV',
              onclick: () => void exportLog('csv'),
            },
            'Export CSV',
          ),
          h(
            'button',
            {
              class: 'quiet',
              'aria-label': 'Export game log as JSON',
              onclick: () => void exportLog('json'),
            },
            'JSON',
          ),
        ),
      ),
      logList,
      logMessage,
    ),
    h(
      'section',
      { class: 'panel-section', 'aria-labelledby': 'panel-settings' },
      h('h2', { id: 'panel-settings' }, 'Settings'),
      key.el,
      h(
        'details',
        { class: 'advanced' },
        h('summary', {}, 'Advanced'),
        h(
          'div',
          { class: 'advanced-body' },
          h('p', { class: 'field-help' }, 'Check the camera and pulse reading on this computer.'),
          h(
            'div',
            { class: 'actions' },
            h('button', { onclick: () => void zz().setDiagnostics(true) }, 'Pulse diagnostics'),
          ),
        ),
      ),
    ),
    h('footer', { class: 'panel-foot' }, deleteBtn, deleteMessage),
  );

  let lastLosses = -1;
  return {
    el,
    update(s: AppSnapshot) {
      const p = s.profile;
      const st = s.identity.status;
      bar.hidden = st === 'verified';
      barDot.className = st === 'checking' ? 'dot idle' : 'dot warn';
      barText.textContent = barCopy(s.identity);
      loginBtn.hidden = st !== 'signed-out';
      retryAt = s.lichessPage.status === 'failed' ? s.lichessPage.retryAt : null;
      offline.hidden = retryAt === null;
      showCountdown();

      identity.set(...identityCopy(s.identity, p.username ?? '?'));
      feedDot.hidden = s.lichess.status !== 'error';
      feed.textContent = feedCopy(s.lichess);
      const camera = p.consent?.mode === 'camera';
      mode.textContent = camera ? 'Camera between games' : 'Timer only';
      baseline.textContent = p.baseline ? `${formatBpm(p.baseline.bpm)} bpm` : 'Not set';
      recalibrate.textContent = camera ? 'Recalibrate' : 'Use camera';
      recalibrate.setAttribute(
        'aria-label',
        camera
          ? 'Recalibrate baseline (one-minute check-in)'
          : 'Use the camera (one-minute check-in)',
      );
      losses.textContent = String(s.consecutiveLosses);
      key.setConfigured(s.presage.apiKeyConfigured);

      const notice = (text: string): HTMLElement =>
        h('p', { class: 'notice' }, h('span', { class: 'dot warn', 'aria-hidden': 'true' }), text);
      notices.replaceChildren(
        ...(camera && !s.presage.apiKeyConfigured
          ? [notice('No Presage API key. Cooldowns use the timer until you add one below.')]
          : []),
        ...(s.presage.sdkError && !s.presage.sdkError.startsWith('loading')
          ? [notice('Pulse reading is unavailable. Cooldowns use the timer.')]
          : []),
      );
      notices.hidden = !notices.childElementCount;

      if (s.consecutiveLosses !== lastLosses) {
        lastLosses = s.consecutiveLosses;
        void refreshLog();
      }
    },
    destroy: () => {
      clearInterval(countdown);
      window.removeEventListener('online', onOnline);
    },
  };
}
