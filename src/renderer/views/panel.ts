import type { AppSnapshot, GameLogEntry } from '../../shared/types';
import { h, zz, type View } from '../dom';
import { apiKeyForm } from './api-key';

const REASON_LABEL = { biometric: 'pulse settled', timer: 'timer', override: 'skipped' } as const;

function logRow(g: GameLogEntry): HTMLElement {
  const when = new Date(g.endedAt).toLocaleString();
  const c = g.cooldown;
  const pulse =
    c?.baselineBpm != null
      ? `baseline ${c.baselineBpm} · after loss ${c.pulseAtLossBpm ?? '–'} bpm · `
      : '';
  const detail = c
    ? `${pulse}unlocked after ${c.timeToUnlockSec}s (${REASON_LABEL[c.unlockReason]})`
    : g.outcome === 'loss'
      ? 'cooldown in progress'
      : '';
  return h(
    'li',
    { class: `log-${g.outcome}` },
    h('strong', {}, g.outcome),
    ` · ${g.speed ?? ''} · ${when}`,
    g.outcome === 'loss' && g.consecutiveLosses ? ` · ${g.consecutiveLosses} in a row` : null,
    detail ? h('div', { class: 'muted' }, detail) : null,
  );
}

function fact(term: string, value: HTMLElement): HTMLElement[] {
  return [h('dt', {}, term), h('dd', {}, value)];
}

/** Side panel shown next to Lichess while playing: status, game log, settings, delete-all. */
export function panelView(): View {
  const identityTitle = h('strong');
  const identityDetail = h('span');
  const identity = h(
    'p',
    { class: 'identity', role: 'status' },
    h('span', { class: 'dot', 'aria-hidden': 'true' }),
    h('span', {}, identityTitle, identityDetail),
  );
  const account = h('span');
  const watcher = h('span');
  const watchDot = h('span', { class: 'dot', 'aria-hidden': 'true' });
  const mode = h('span');
  const baseline = h('span');
  const losses = h('span');
  const facts = h(
    'dl',
    { class: 'facts panel-facts' },
    ...fact('Lichess', account),
    ...fact('Games', h('span', {}, watchDot, ' ', watcher)),
    ...fact('Mode', mode),
    ...fact('Baseline', baseline),
    ...fact('Losses in a row', losses),
  );
  const warnings = h('div', { class: 'panel-warnings' });
  const message = h('p', { class: 'muted', role: 'status' });
  const logList = h('ol', { class: 'log' });
  let deleteArmed = false;
  const deleteBtn = h('button', { class: 'danger' }, 'Delete all my data');

  const refreshLog = async (): Promise<void> => {
    const games = await zz().getLog();
    logList.replaceChildren(
      ...(games.length
        ? games.map(logRow)
        : [h('li', { class: 'log-empty' }, 'No finished games yet.')]),
    );
  };

  deleteBtn.addEventListener('click', async () => {
    if (!deleteArmed) {
      deleteArmed = true;
      deleteBtn.textContent = 'Click again to delete log, baseline and consent';
      return;
    }
    const res = await zz().deleteAllData();
    message.textContent = res.ok ? 'All local data deleted.' : res.error;
  });

  const exportLog = async (format: 'csv' | 'json'): Promise<void> => {
    const res = await zz().exportLog(format);
    message.textContent = res.ok ? 'Game log exported.' : res.error;
  };

  // Sits above the Lichess view (main leaves room for it) while play is not allowed.
  const barText = h('span');
  const loginBtn = h(
    'button',
    { class: 'primary', onclick: () => void zz().openLichessLogin() },
    'Open Lichess sign-in',
  );
  const bar = h('div', { class: 'signin-bar', role: 'status' }, barText, loginBtn);

  const recalibrate = h(
    'button',
    { onclick: () => void zz().recalibrate() },
    'Recalibrate (1 min)',
  );
  const el = h(
    'aside',
    { class: 'panel', 'aria-label': 'Zwischenzug' },
    bar,
    h(
      'header',
      { class: 'panel-head' },
      h('h1', {}, 'Zwischenzug'),
      h('p', { class: 'muted' }, 'A pause after a loss, before the next game.'),
    ),
    identity,
    facts,
    warnings,
    h(
      'section',
      { class: 'panel-section', 'aria-labelledby': 'panel-pulse' },
      h('h2', { id: 'panel-pulse' }, 'Pulse'),
      h(
        'div',
        { class: 'actions' },
        recalibrate,
        h('button', { onclick: () => void zz().setDiagnostics(true) }, 'Presage diagnostics'),
      ),
    ),
    h(
      'section',
      { class: 'panel-section', 'aria-labelledby': 'panel-log' },
      h('h2', { id: 'panel-log' }, 'Game log'),
      logList,
      h(
        'div',
        { class: 'actions' },
        h('button', { onclick: () => void exportLog('csv') }, 'Export CSV'),
        h('button', { onclick: () => void exportLog('json') }, 'Export JSON'),
      ),
    ),
    h(
      'section',
      { class: 'panel-section', 'aria-labelledby': 'panel-settings' },
      h('h2', { id: 'panel-settings' }, 'Settings'),
      apiKeyForm(),
    ),
    h('section', { class: 'panel-section danger-zone' }, deleteBtn, message),
  );

  let lastLosses = -1;
  return {
    el,
    update(s: AppSnapshot) {
      const p = s.profile;
      const st = s.identity.status;
      const verified = st === 'verified';
      bar.hidden = verified;
      barText.textContent =
        st === 'signed-out' || st === 'wrong-account'
          ? `${s.identity.message} Games are blocked until then.`
          : s.identity.message;
      loginBtn.hidden = st !== 'signed-out';

      identity.dataset.status = st;
      identityTitle.textContent = verified
        ? `${s.identity.message}. Play allowed.`
        : st === 'checking'
          ? s.identity.message
          : 'Games are blocked.';
      identityDetail.textContent = verified || st === 'checking' ? '' : ` ${s.identity.message}`;

      account.textContent = `@${p.username ?? '?'}`;
      watchDot.className = `dot ${s.lichess.status}`;
      watcher.textContent = s.lichess.message ?? s.lichess.status;
      mode.textContent = p.consent?.mode === 'camera' ? 'Camera between games' : 'Timer only';
      baseline.textContent = p.baseline ? `${p.baseline.bpm} bpm` : 'Not set';
      losses.textContent = String(s.consecutiveLosses);
      recalibrate.textContent =
        p.consent?.mode === 'camera' ? 'Recalibrate (1 min)' : 'Use the camera (1-min check-in)';
      const warn = (text: string): HTMLElement => h('p', { class: 'warn' }, text);
      warnings.replaceChildren(
        ...(p.consent?.mode === 'camera' && !s.presage.apiKeyConfigured
          ? [warn('No Presage API key: cooldowns will use the timer.')]
          : []),
        ...(s.presage.sdkError ? [warn(`Presage SDK: ${s.presage.sdkError}`)] : []),
      );
      if (s.consecutiveLosses !== lastLosses) {
        lastLosses = s.consecutiveLosses;
        void refreshLog();
      }
    },
    destroy: () => undefined,
  };
}
