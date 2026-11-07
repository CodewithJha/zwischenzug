import type { AppSnapshot, GameLogEntry } from '../../shared/types';
import { h, zz, type View } from '../dom';
import { apiKeyForm } from './api-key';

const REASON_LABEL = { biometric: 'pulse settled', timer: 'timer', override: 'skipped' } as const;

function logRow(g: GameLogEntry): HTMLElement {
  const when = new Date(g.endedAt).toLocaleString();
  const c = g.cooldown;
  const detail = c
    ? `baseline ${c.baselineBpm ?? '–'} · after loss ${c.pulseAtLossBpm ?? '–'} bpm · ` +
      `unlocked after ${c.timeToUnlockSec}s (${REASON_LABEL[c.unlockReason]})`
    : g.outcome === 'loss'
      ? 'cooldown in progress'
      : '';
  return h(
    'li',
    { class: `log-${g.outcome}` },
    h('strong', {}, g.outcome),
    ` · ${g.speed ?? ''} · ${when}`,
    detail ? h('div', { class: 'muted' }, detail) : null,
  );
}

/** Side panel shown next to Lichess while playing: status, game log, settings, delete-all. */
export function panelView(): View {
  const status = h('div', { class: 'status' });
  const message = h('p', { class: 'muted', role: 'status' });
  const logList = h('ol', { class: 'log' });
  let deleteArmed = false;
  const deleteBtn = h('button', { class: 'danger' }, 'Delete all my data');

  const refreshLog = async (): Promise<void> => {
    const games = await zz().getLog();
    logList.replaceChildren(
      ...(games.length ? games.map(logRow) : [h('li', { class: 'muted' }, 'No games yet.')]),
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

  const el = h(
    'aside',
    { class: 'panel' },
    h('h1', {}, 'Zwischenzug'),
    status,
    h(
      'div',
      { class: 'actions' },
      h('button', { onclick: () => void zz().recalibrate() }, 'Recalibrate (1 min)'),
    ),
    h('h2', {}, 'Game log'),
    logList,
    h('h2', {}, 'Settings'),
    apiKeyForm(),
    deleteBtn,
    message,
  );

  let lastLosses = -1;
  return {
    el,
    update(s: AppSnapshot) {
      const p = s.profile;
      const mode = p.consent?.mode === 'camera' ? 'camera between games' : 'timer only';
      const lines: (HTMLElement | null)[] = [
        h(
          'div',
          {},
          `Lichess: @${p.username ?? '?'} · `,
          h('span', { class: `dot ${s.lichess.status}` }),
          ` ${s.lichess.message ?? s.lichess.status}`,
        ),
        h('div', {}, `Mode: ${mode}`),
        h('div', {}, `Baseline: ${p.baseline ? `${p.baseline.bpm} bpm` : 'not set'}`),
        h('div', {}, `Losses in a row: ${s.consecutiveLosses}`),
        p.consent?.mode === 'camera' && !s.presage.apiKeyConfigured
          ? h('div', { class: 'warn' }, 'No Presage API key: cooldowns will use the timer.')
          : null,
        s.presage.sdkError
          ? h('div', { class: 'warn' }, `Presage SDK: ${s.presage.sdkError}`)
          : null,
      ];
      status.replaceChildren(...lines.filter((l): l is HTMLElement => l !== null));
      if (s.consecutiveLosses !== lastLosses) {
        lastLosses = s.consecutiveLosses;
        void refreshLog();
      }
    },
    destroy: () => undefined,
  };
}
