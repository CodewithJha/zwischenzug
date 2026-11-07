import { computeBaseline } from '../../core/pulse';
import type { AppSnapshot } from '../../shared/types';
import type { BiometricProvider } from '../biometrics/provider';
import { formatSec, h, zz, type View } from '../dom';
import { apiKeyForm } from './api-key';

/** One-minute check-in: collects stable pulse readings and saves their median as baseline. */
export function calibrationView(provider: BiometricProvider): View {
  const video = h('video', { class: 'preview', muted: true, autoplay: true, playsinline: true });
  const hint = h('p', { class: 'hint' });
  const progress = h('p', { class: 'muted' });
  const live = h('div', { class: 'bpm' }, '–');
  const startBtn = h('button', { class: 'primary' }, 'Start check-in');
  const error = h('p', { class: 'error', role: 'alert' });
  const keySlot = h('div');
  let durationSec = 60;
  let minSamples = 10;
  let timer: number | null = null;

  const finish = async (samples: number[]): Promise<void> => {
    await provider.stop();
    video.srcObject = null;
    const baseline = computeBaseline(samples, minSamples);
    if (!baseline) {
      startBtn.disabled = false;
      startBtn.textContent = 'Try again';
      error.textContent =
        `Could not get a steady reading (${samples.length} usable samples, need ${minSamples}). ` +
        'Check the light on your face and sit still, or use the timer instead.';
      return;
    }
    const res = await zz().saveBaseline(baseline.bpm, baseline.samples);
    if (!res.ok) error.textContent = res.error;
  };

  const start = (): void => {
    startBtn.disabled = true;
    error.textContent = '';
    const samples: number[] = [];
    let measuringSince: number | null = null;
    void provider.start({
      reading: (r) => {
        if (!r.stable) return;
        samples.push(r.bpm);
        live.textContent = `${Math.round(r.bpm)} bpm`;
      },
      state: (s) => {
        if (s.kind === 'unavailable') {
          if (timer !== null) window.clearInterval(timer);
          timer = null;
          startBtn.disabled = false;
          startBtn.textContent = 'Try again';
          error.textContent = `${s.reason} You can use the timer instead.`;
          return;
        }
        if (s.kind === 'measuring' && measuringSince === null) measuringSince = Date.now();
        hint.textContent =
          s.kind === 'starting'
            ? 'Starting camera...'
            : s.ok
              ? 'Good. Stay relaxed and still.'
              : (s.hint ?? 'Adjusting...');
      },
      stream: (stream) => {
        video.srcObject = stream;
        void video.play().catch(() => undefined);
      },
    });
    timer = window.setInterval(() => {
      const elapsed = measuringSince === null ? 0 : (Date.now() - measuringSince) / 1000;
      progress.textContent = `${formatSec(Math.min(durationSec, Math.floor(elapsed)))} / ${formatSec(durationSec)} · ${samples.length} readings`;
      if (elapsed >= durationSec) {
        if (timer !== null) window.clearInterval(timer);
        timer = null;
        void finish(samples);
      }
    }, 500);
  };
  startBtn.addEventListener('click', start);

  const el = h(
    'section',
    { class: 'screen calibration' },
    h('h1', {}, 'One-minute check-in'),
    h(
      'p',
      {},
      'Sit the way you usually sit when you play, with light in front of you. ' +
        'Zwischenzug reads your resting pulse for a minute and uses it as your baseline. ' +
        'The camera turns off when the check-in ends.',
    ),
    keySlot,
    h('div', { class: 'monitor' }, video, h('div', {}, live, hint, progress)),
    h(
      'div',
      { class: 'actions' },
      startBtn,
      h('button', { onclick: () => void zz().giveConsent('timer-only') }, 'Use the timer instead'),
      h('button', { onclick: () => void zz().setDiagnostics(true) }, 'Presage diagnostics'),
    ),
    error,
  );

  return {
    el,
    update(s: AppSnapshot) {
      durationSec = s.settings.calibrationSec;
      minSamples = s.settings.calibrationMinSamples;
      if (!s.presage.apiKeyConfigured && !keySlot.firstChild) keySlot.append(apiKeyForm());
      if (s.presage.apiKeyConfigured) keySlot.replaceChildren();
      startBtn.disabled = timer !== null || !s.presage.apiKeyConfigured || !s.presage.sdkLoaded;
      if (!s.presage.sdkLoaded) hint.textContent = s.presage.sdkError ?? 'Presage SDK not loaded.';
    },
    destroy: () => {
      if (timer !== null) window.clearInterval(timer);
      video.srcObject = null;
      void provider.stop();
    },
  };
}
