import type { AppSnapshot, CooldownView } from '../../shared/types';
import type { BiometricProvider, ProviderState } from '../biometrics/provider';
import { formatSec, h, zz, type View } from '../dom';
import { unlockPath, type UnlockPath } from './unlock-path';

const PATH_TITLE = {
  pulse: 'Unlocking by pulse',
  waiting: 'Getting a pulse reading',
  timer: 'Unlocking by timer',
} as const;

/** A labelled progress row. `<progress>` keeps the value available to assistive tech. */
function conditionRow(): {
  el: HTMLElement;
  set(label: string, value: string, fraction: number, done: boolean): void;
} {
  const label = h('span', { class: 'cond-label' });
  const value = h('span', { class: 'cond-value' });
  const bar = h('progress', { max: '1', value: '0' });
  const el = h('li', { class: 'cond' }, label, value, bar);
  return {
    el,
    set(l, v, fraction, done) {
      label.textContent = l;
      value.textContent = v;
      bar.value = Math.max(0, Math.min(1, fraction));
      bar.setAttribute('aria-label', `${l}: ${v}`);
      el.classList.toggle('done', done);
    },
  };
}

/** Horizontal scale: your band (up to baseline + tolerance), baseline, pulse at loss, now. */
function pulseGauge(): { el: HTMLElement; update(c: CooldownView): void } {
  const band = h('div', { class: 'gauge-band' });
  const baseline = h('div', { class: 'gauge-baseline' });
  const loss = h('div', { class: 'gauge-loss', title: 'At the loss' });
  const now = h('div', { class: 'gauge-now' });
  const nowRail = h('div', { class: 'gauge-now-rail' }, now);
  const lo = h('span');
  const mid = h('span', { class: 'gauge-band-label' });
  const hi = h('span');
  const el = h(
    'div',
    { class: 'gauge', role: 'img' },
    h('div', { class: 'gauge-track' }, band, baseline, loss, nowRail),
    h('div', { class: 'gauge-labels', 'aria-hidden': 'true' }, lo, mid, hi),
  );
  return {
    el,
    update(c) {
      if (c.baselineBpm === null || c.upperBandBpm === null) return;
      const min = Math.floor(c.baselineBpm - 20);
      const max = Math.ceil(
        Math.max(c.upperBandBpm + 30, (c.pulseAtLossBpm ?? 0) + 6, (c.lastBpm ?? 0) + 6),
      );
      const pct = (bpm: number): string =>
        `${Math.max(0, Math.min(100, ((bpm - min) / (max - min)) * 100))}%`;
      band.style.width = pct(c.upperBandBpm);
      baseline.style.left = pct(c.baselineBpm);
      loss.hidden = c.pulseAtLossBpm === null;
      if (c.pulseAtLossBpm !== null) loss.style.left = pct(c.pulseAtLossBpm);
      nowRail.hidden = c.lastBpm === null;
      if (c.lastBpm !== null) nowRail.style.transform = `translateX(${pct(c.lastBpm)})`;
      el.classList.toggle('in-band', c.lastBpm !== null && c.lastBpm <= c.upperBandBpm);
      lo.textContent = String(min);
      mid.textContent = `your band, up to ${c.upperBandBpm}`;
      mid.style.left = pct(c.upperBandBpm);
      hi.textContent = String(max);
      el.setAttribute(
        'aria-label',
        `Your band is up to ${c.upperBandBpm} bpm (baseline ${c.baselineBpm}).` +
          (c.lastBpm !== null ? ` Now ${Math.round(c.lastBpm)} bpm.` : ' No reading right now.') +
          (c.pulseAtLossBpm !== null ? ` At the loss ${Math.round(c.pulseAtLossBpm)} bpm.` : ''),
      );
    },
  };
}

/**
 * Full-window lock screen after a loss. Main owns the decision; this view shows the numbers,
 * which unlock path is active and why, and offers the override. With `provider` (camera mode
 * with a baseline) it measures for the cooldown's lifetime and forwards readings to main.
 */
export function cooldownView(provider: BiometricProvider | null): View {
  let latest: AppSnapshot | null = null;
  let providerState: ProviderState | null = null;

  const meta = h('span', { class: 'cd-meta' });
  const rule = h('p', { class: 'cd-rule' });
  const pathTitle = h('strong');
  const pathDetail = h('span', { class: 'path-detail' });
  const pathChip = h('p', { class: 'path', role: 'status' }, pathTitle, pathDetail);
  const big = h('span', { class: 'readout-value' }, '–');
  const unit = h('span', { class: 'readout-unit' });
  const distance = h('p', { class: 'distance' });
  const gauge = pulseGauge();
  const facts = h('p', { class: 'cd-facts' });
  const minWait = conditionRow();
  const settled = conditionRow();
  const timer = conditionRow();
  const conditions = h('ol', { class: 'conditions' }, minWait.el, settled.el, timer.el);
  const cap = h('p', { class: 'cd-cap' });
  const suggestion = h('p', { class: 'suggestion' });
  const video = h('video', { class: 'preview', muted: true, autoplay: true, playsinline: true });
  const cameraNote = h('p', { class: 'camera-note' });
  const camera = h('figure', { class: 'camera' }, video, h('figcaption', {}, cameraNote));
  camera.hidden = provider === null;

  const sentence = h('q', { class: 'sentence' });
  const input = h('input', {
    id: 'override',
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-describedby': 'override-help',
  });
  const error = h('p', { class: 'error', role: 'alert' });
  const submit = async (e: Event): Promise<void> => {
    e.preventDefault();
    const res = await zz().override(input.value);
    if (!res.ok) error.textContent = `${res.error} Type it exactly as shown.`;
  };

  const render = (): void => {
    const s = latest;
    const c = s?.cooldown;
    if (!s || !c) return;
    const path: UnlockPath = unlockPath(s, providerState);
    const pulseRule = s.profile.consent?.mode === 'camera' && c.baselineBpm !== null;

    meta.textContent =
      s.consecutiveLosses > 1 ? `${s.consecutiveLosses} losses in a row` : 'After a loss';
    rule.textContent = pulseRule
      ? `New games unlock once your pulse has stayed near your baseline for ${c.sustainSec} seconds, ` +
        `after a pause of at least ${formatSec(c.minWaitSec)}. Without a reading, a timer unlocks instead.`
      : `New games unlock when the timer ends (${formatSec(c.fallbackSec)}).`;

    document.body.dataset.path = path.kind;
    pathTitle.textContent = PATH_TITLE[path.kind];
    pathDetail.textContent =
      path.kind === 'pulse'
        ? 'Live reading from your camera, processed on this computer.'
        : path.kind === 'waiting'
          ? path.detail
          : path.reason;

    // Readout: the live pulse on the pulse path, otherwise the timer countdown.
    const showPulse = path.kind !== 'timer';
    if (showPulse) {
      big.textContent = c.lastBpm !== null ? String(Math.round(c.lastBpm)) : '–';
      unit.textContent = 'bpm now';
    } else {
      big.textContent = formatSec(c.fallbackRemainingSec);
      unit.textContent = 'until the timer unlocks';
    }
    const band = c.upperBandBpm;
    distance.textContent =
      c.lastBpm === null || band === null
        ? pulseRule
          ? 'No pulse reading right now.'
          : ''
        : c.lastBpm <= band
          ? 'Back near your baseline.'
          : `${Math.round(c.lastBpm - band)} bpm above your band.`;
    distance.classList.toggle('in-band', c.lastBpm !== null && band !== null && c.lastBpm <= band);

    gauge.el.hidden = !pulseRule;
    gauge.update(c);
    facts.textContent = pulseRule
      ? `Baseline ${c.baselineBpm} bpm · band up to ${band} bpm · at the loss ` +
        (c.pulseAtLossBpm !== null ? `${Math.round(c.pulseAtLossBpm)} bpm` : '–')
      : '';

    const waited = c.minWaitSec - c.minWaitRemainingSec;
    minWait.set(
      'Minimum pause',
      c.minWaitRemainingSec > 0 ? `${formatSec(c.minWaitRemainingSec)} left` : 'Done',
      c.minWaitSec ? waited / c.minWaitSec : 1,
      c.minWaitRemainingSec === 0,
    );
    minWait.el.hidden = path.kind === 'timer';
    settled.el.hidden = path.kind === 'timer';
    const held = Math.min(c.settledForSec, c.sustainSec);
    settled.set(
      'Pulse near your baseline',
      path.kind === 'pulse' ? `${held} / ${c.sustainSec} s` : 'Waiting for a reading',
      held / c.sustainSec,
      held >= c.sustainSec,
    );
    timer.el.hidden = path.kind === 'pulse';
    timer.set(
      path.kind === 'timer' ? 'Timer' : 'Timer, if no reading arrives',
      `${formatSec(c.fallbackRemainingSec)} left`,
      (c.fallbackSec - c.fallbackRemainingSec) / c.fallbackSec,
      c.fallbackRemainingSec === 0,
    );
    cap.textContent =
      path.kind === 'timer' ? '' : `Unlocks at the latest in ${formatSec(c.maxRemainingSec)}.`;

    suggestion.textContent =
      c.suggestedPauseUntil && c.suggestedPauseUntil > Date.now()
        ? `${s.consecutiveLosses} losses in a row. A longer break helps: consider stepping away ` +
          `until ${new Date(c.suggestedPauseUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
        : '';
    sentence.textContent = s.settings.overrideSentence;

    cameraNote.textContent =
      providerState?.kind === 'measuring'
        ? providerState.ok
          ? 'Camera on for this pause only. Video stays on this computer.'
          : (providerState.hint ?? 'Adjusting...')
        : providerState?.kind === 'unavailable'
          ? 'Camera off.'
          : 'Starting camera...';
  };

  if (provider) {
    void provider.start({
      reading: (r) => zz().reportPulse(r.bpm, r.stable),
      state: (st) => {
        providerState = st;
        if (st.kind === 'unavailable') video.srcObject = null;
        render();
      },
      stream: (stream) => {
        video.srcObject = stream;
        void video.play().catch(() => undefined);
      },
    });
  }

  const el = h(
    'section',
    { class: 'cooldown', 'aria-labelledby': 'cd-title' },
    h('header', { class: 'cd-top' }, h('span', { class: 'brand' }, 'Zwischenzug'), meta),
    h('h1', { id: 'cd-title' }, 'Take a moment before the next game.'),
    rule,
    h(
      'div',
      { class: 'cd-main' },
      h(
        'div',
        { class: 'instrument' },
        pathChip,
        h('p', { class: 'readout' }, big, unit),
        distance,
        gauge.el,
        facts,
      ),
      camera,
    ),
    conditions,
    cap,
    suggestion,
    h(
      'div',
      { class: 'breathe' },
      h('div', { class: 'breathe-circle', 'aria-hidden': 'true' }),
      h(
        'p',
        {},
        h('strong', {}, 'Breathing guide: '),
        'in for 4, out for 6. ',
        h('span', { class: 'muted' }, 'A fixed pace to follow, not a measurement.'),
      ),
    ),
    h(
      'details',
      { class: 'override' },
      h('summary', {}, 'Skip this cooldown'),
      h(
        'form',
        { onsubmit: (e) => void submit(e) },
        h('label', { for: 'override' }, 'Type this sentence to unlock now:'),
        h('p', { id: 'override-help', class: 'override-help' }, sentence),
        input,
        h('button', { type: 'submit' }, 'Skip and unlock'),
        error,
      ),
    ),
  );

  return {
    el,
    update(s: AppSnapshot) {
      latest = s;
      render();
    },
    destroy: () => {
      delete document.body.dataset.path;
      video.srcObject = null;
      if (provider) void provider.stop();
    },
  };
}
