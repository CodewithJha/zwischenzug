import type { AppSnapshot, CooldownView } from '../../shared/types';
import type { BiometricProvider, ProviderState } from '../biometrics/provider';
import { cameraPreview, meter, statusLine } from '../components';
import { h, topbar, zz, type View } from '../dom';
import { formatBpm, formatClock, formatSec } from '../format';
import { unlockPath, type UnlockPath } from './unlock-path';

const STATUS_TITLE = {
  pulse: 'Live pulse',
  waiting: 'Finding your pulse',
  timer: 'Timer',
} as const;
/** Gauge labels closer than this (percent of the scale) would overlap; the loss label yields. */
const LABEL_MIN_GAP = 18;
/** Past this position a label is right-aligned so it stays inside the gauge. */
const LABEL_END_AT = 85;
/** Restarts of the pulse measurement after a retryable failure, per cooldown. */
const MAX_RESTARTS = 5;
const RESTART_DELAY_MS = 15_000;

/** Horizontal scale: your band (up to baseline + tolerance), baseline, pulse at loss, now. */
function pulseGauge(): { el: HTMLElement; update(c: CooldownView): void } {
  const band = h('div', { class: 'gauge-band' });
  const baseline = h('div', { class: 'gauge-tick' });
  const loss = h('div', { class: 'gauge-tick loss' });
  const now = h('div', { class: 'gauge-now-rail' }, h('div', { class: 'gauge-now' }));
  const baselineLabel = h('span', { class: 'gauge-label' });
  const lossLabel = h('span', { class: 'gauge-label' });
  const el = h(
    'div',
    { class: 'gauge', role: 'img' },
    h('div', { class: 'gauge-track' }, band, baseline, loss, now),
    h('div', { class: 'gauge-labels', 'aria-hidden': 'true' }, baselineLabel, lossLabel),
  );
  const place = (node: HTMLElement, pct: number): void => {
    node.style.setProperty('--x', `${pct}%`);
    node.dataset.edge = pct > LABEL_END_AT ? 'end' : '';
  };
  return {
    el,
    update(c) {
      if (c.baselineBpm === null || c.upperBandBpm === null) return;
      const min = Math.floor(c.baselineBpm - 20);
      const max = Math.ceil(
        Math.max(c.upperBandBpm + 30, (c.pulseAtLossBpm ?? 0) + 6, (c.lastBpm ?? 0) + 6),
      );
      const pct = (bpm: number): number =>
        Math.max(0, Math.min(100, ((bpm - min) / (max - min)) * 100));
      place(band, pct(c.upperBandBpm));
      place(baseline, pct(c.baselineBpm));
      place(baselineLabel, pct(c.baselineBpm));
      baselineLabel.textContent = `${formatBpm(c.baselineBpm)} baseline`;
      loss.hidden = c.pulseAtLossBpm === null;
      lossLabel.hidden =
        c.pulseAtLossBpm === null ||
        Math.abs(pct(c.pulseAtLossBpm) - pct(c.baselineBpm)) < LABEL_MIN_GAP;
      if (c.pulseAtLossBpm !== null) {
        place(loss, pct(c.pulseAtLossBpm));
        place(lossLabel, pct(c.pulseAtLossBpm));
        lossLabel.textContent = `${formatBpm(c.pulseAtLossBpm)} at the loss`;
      }
      now.hidden = c.lastBpm === null;
      if (c.lastBpm !== null) now.style.setProperty('--x', `${pct(c.lastBpm)}%`);
      el.setAttribute(
        'aria-label',
        `Your band is up to ${c.upperBandBpm} bpm (baseline ${formatBpm(c.baselineBpm)}).` +
          (c.lastBpm !== null ? ` Now ${formatBpm(c.lastBpm)} bpm.` : ' No reading right now.') +
          (c.pulseAtLossBpm !== null ? ` At the loss ${formatBpm(c.pulseAtLossBpm)} bpm.` : ''),
      );
    },
  };
}

/** Plain reason for the timer path; raw SDK errors stay in diagnostics. */
function timerReason(s: AppSnapshot, path: Extract<UnlockPath, { kind: 'timer' }>): string {
  return s.presage.sdkLoaded ? path.reason : 'Pulse reading is unavailable on this computer.';
}

/**
 * Full-window lock screen after a loss. Main owns the decision; this view shows the numbers,
 * which unlock path is active and why, and offers the override. With `provider` (camera mode
 * with a baseline) it measures for the cooldown's lifetime and forwards readings to main.
 */
export function cooldownView(provider: BiometricProvider | null): View {
  let latest: AppSnapshot | null = null;
  let providerState: ProviderState | null = null;

  const losses = h('span');
  const title = h('h1', { id: 'cd-title' });
  const rule = h('p', { class: 'cd-rule' });
  const suggestion = h('p', { class: 'cd-note' });
  const status = statusLine();
  const value = h('span', { class: 'readout-value' }, '–');
  const unit = h('span', { class: 'readout-unit' });
  const gauge = pulseGauge();
  const progress = meter();
  const foot = h('p', { class: 'cd-foot' });
  const camera = cameraPreview();
  camera.el.hidden = provider === null;

  const sentence = h('blockquote', { id: 'override-sentence', class: 'sentence' });
  const input = h('input', {
    id: 'override',
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-describedby': 'override-sentence',
  });
  const error = h('p', { class: 'error', role: 'alert' });
  const submit = async (e: Event): Promise<void> => {
    e.preventDefault();
    const res = await zz().override(input.value);
    if (!res.ok) error.textContent = `${res.error} Type it exactly as shown.`;
  };

  const el = h(
    'section',
    { class: 'cooldown', 'aria-labelledby': 'cd-title' },
    topbar(losses),
    h(
      'div',
      { class: 'cd-body' },
      h(
        'div',
        { class: 'cd-main' },
        h('div', { class: 'cd-head' }, title, rule, suggestion),
        status.el,
        h('p', { class: 'readout' }, value, unit),
        gauge.el,
        progress.el,
        foot,
      ),
      camera.el,
    ),
    h(
      'footer',
      { class: 'cd-footer' },
      h(
        'p',
        { class: 'breathe' },
        h('span', { class: 'breathe-dot', 'aria-hidden': 'true' }),
        'Breathe in for 4, out for 6',
      ),
      h(
        'details',
        { class: 'override' },
        h('summary', {}, 'Skip cooldown'),
        h(
          'form',
          { onsubmit: (e) => void submit(e) },
          h('label', { for: 'override' }, 'To skip, type this sentence'),
          sentence,
          h('div', { class: 'input-row' }, input, h('button', { type: 'submit' }, 'Skip')),
          error,
        ),
      ),
    ),
  );

  const render = (): void => {
    const s = latest;
    const c = s?.cooldown;
    if (!s || !c) return;
    const path = unlockPath(s, providerState);
    const pulseRule = s.profile.consent?.mode === 'camera' && c.baselineBpm !== null;
    const band = c.upperBandBpm;
    const inBand = c.lastBpm !== null && band !== null && c.lastBpm <= band;
    const now = Date.now();
    el.dataset.path = path.kind;
    el.dataset.band = inBand ? 'in' : 'out';

    losses.textContent =
      s.consecutiveLosses > 1 ? `${s.consecutiveLosses} losses in a row` : 'After a loss';
    title.textContent = pulseRule
      ? 'Your next game unlocks when your pulse settles.'
      : 'Your next game unlocks when the timer ends.';
    rule.textContent = pulseRule
      ? `${c.sustainSec} s near your baseline, after at least ${formatSec(c.minWaitSec)}. ` +
        'No reading? The timer takes over.'
      : '';
    rule.hidden = !pulseRule;
    const pauseUntil = c.suggestedPauseUntil;
    suggestion.textContent =
      pauseUntil && pauseUntil > now
        ? `Consider a longer break, until ${formatClock(pauseUntil)}.`
        : '';
    suggestion.hidden = !suggestion.textContent;

    if (path.kind === 'pulse') {
      status.set(
        'live',
        STATUS_TITLE.pulse,
        inBand || band === null || c.lastBpm === null
          ? 'Near your baseline.'
          : `${formatBpm(c.lastBpm - band)} bpm to go.`,
      );
    } else if (path.kind === 'waiting') {
      status.set('idle', STATUS_TITLE.waiting, path.detail);
    } else {
      status.set('neutral', STATUS_TITLE.timer, timerReason(s, path));
    }

    // One big number: the pulse whenever pulse unlock is possible, otherwise the countdown.
    const showPulse = path.kind !== 'timer';
    value.textContent = !showPulse
      ? formatSec(c.fallbackRemainingSec)
      : c.lastBpm === null
        ? '––'
        : formatBpm(c.lastBpm);
    value.classList.toggle('empty', showPulse && c.lastBpm === null);
    unit.textContent = showPulse ? 'bpm' : 'left';

    gauge.el.hidden = !pulseRule;
    gauge.update(c);

    const timerFraction = (c.fallbackSec - c.fallbackRemainingSec) / c.fallbackSec;
    if (path.kind === 'pulse') {
      const held = Math.min(c.settledForSec, c.sustainSec);
      progress.set('Near your baseline', `${held} / ${c.sustainSec} s`, held / c.sustainSec, true);
    } else if (path.kind === 'waiting') {
      progress.set('Timer', `${formatSec(c.fallbackRemainingSec)} left`, timerFraction);
    } else {
      progress.set(
        'Timer',
        `ends ${formatClock(now + c.fallbackRemainingSec * 1000)}`,
        timerFraction,
      );
    }

    const num = (text: string): HTMLElement => h('span', { class: 'num' }, text);
    foot.replaceChildren(
      ...(c.minWaitRemainingSec > 0
        ? ['Minimum pause ', num(formatSec(c.minWaitRemainingSec)), ' · ']
        : []),
      'Unlocks by ',
      num(formatClock(now + c.maxRemainingSec * 1000)),
      ' at the latest',
    );
    foot.hidden = path.kind === 'timer';

    sentence.textContent = s.settings.overrideSentence;

    camera.el.hidden = provider === null || providerState?.kind === 'unavailable';
    camera.caption(
      providerState?.kind === 'measuring'
        ? 'On for this pause only. Video stays on this computer.'
        : 'Starting camera…',
    );
  };

  let restarts = 0;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  const startProvider = (p: BiometricProvider): void => {
    void p.start({
      reading: (r) => zz().reportPulse(r.bpm, r.stable),
      state: (st) => {
        providerState = st;
        if (st.kind === 'unavailable') {
          camera.video.srcObject = null;
          // E.g. no face right after the loss: measure again when the player is back.
          if (st.retryable && restarts < MAX_RESTARTS) {
            restarts++;
            providerState = { ...st, reason: `${st.reason} Trying again shortly.` };
            restartTimer = setTimeout(() => startProvider(p), RESTART_DELAY_MS);
          }
        }
        render();
      },
      stream: (stream) => {
        camera.video.srcObject = stream;
        void camera.video.play().catch(() => undefined);
      },
    });
  };
  if (provider) startProvider(provider);

  return {
    el,
    update(s: AppSnapshot) {
      latest = s;
      render();
    },
    destroy: () => {
      clearTimeout(restartTimer);
      camera.video.srcObject = null;
      if (provider) void provider.stop();
    },
  };
}
