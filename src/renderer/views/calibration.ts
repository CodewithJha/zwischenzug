import { computeBaseline } from '../../core/pulse';
import type { AppSnapshot } from '../../shared/types';
import type { BiometricProvider } from '../biometrics/provider';
import { cameraPreview, meter, statusLine } from '../components';
import { h, topbar, zz, type View } from '../dom';
import { formatBpm, formatSec } from '../format';
import { apiKeyForm } from './api-key';

/** One-minute check-in: collects stable pulse readings and saves their median as baseline. */
export function calibrationView(provider: BiometricProvider): View {
  const camera = cameraPreview();
  camera.caption('Camera off until you start.');
  const status = statusLine();
  status.set('idle', 'Ready', 'Sit as you usually do when you play.');
  const value = h('span', { class: 'readout-value empty' }, '––');
  const progress = meter();
  progress.el.hidden = true;
  const startBtn = h('button', { class: 'primary' }, 'Start check-in');
  const error = h('p', { class: 'error', role: 'alert' });
  const troubleshoot = h(
    'button',
    { class: 'quiet', onclick: () => void zz().setDiagnostics(true) },
    'Troubleshoot',
  );
  troubleshoot.hidden = true;
  const keySlot = h('div');
  let durationSec = 60;
  let minSamples = 10;
  let timer: number | null = null;

  const fail = (message: string): void => {
    startBtn.disabled = false;
    startBtn.textContent = 'Try again';
    error.textContent = message;
    troubleshoot.hidden = false;
  };

  const finish = async (samples: number[]): Promise<void> => {
    await provider.stop();
    camera.video.srcObject = null;
    camera.caption('Camera off.');
    const baseline = computeBaseline(samples, minSamples);
    if (!baseline) {
      status.set('neutral', 'No steady reading', 'Add light in front of you and sit still.');
      fail('Couldn’t get a steady reading. Try again, or use the timer instead.');
      return;
    }
    const res = await zz().saveBaseline(baseline.bpm, baseline.samples);
    if (!res.ok) error.textContent = res.error;
  };

  const start = (): void => {
    startBtn.disabled = true;
    error.textContent = '';
    troubleshoot.hidden = true;
    const samples: number[] = [];
    let measuringSince: number | null = null;
    void provider.start({
      reading: (r) => {
        if (!r.stable) return;
        samples.push(r.bpm);
        value.textContent = formatBpm(r.bpm);
        value.classList.remove('empty');
      },
      state: (s) => {
        if (s.kind === 'unavailable') {
          if (timer !== null) window.clearInterval(timer);
          timer = null;
          camera.caption('Camera off.');
          status.set('neutral', 'Camera off', s.reason);
          progress.el.hidden = true;
          fail('You can try again or use the timer instead.');
          return;
        }
        if (s.kind === 'measuring' && measuringSince === null) measuringSince = Date.now();
        camera.caption('On for this check-in only. Video stays on this computer.');
        if (s.kind === 'starting') status.set('idle', 'Starting', 'Turning on the camera…');
        else if (s.ok) status.set('live', 'Reading', 'Good. Stay relaxed and still.');
        else status.set('idle', 'Adjusting', s.hint ?? 'Hold still for a moment.');
      },
      stream: (stream) => {
        camera.video.srcObject = stream;
        void camera.video.play().catch(() => undefined);
      },
    });
    timer = window.setInterval(() => {
      const elapsed = measuringSince === null ? 0 : (Date.now() - measuringSince) / 1000;
      progress.el.hidden = false;
      progress.set(
        `${samples.length} readings`,
        `${formatSec(Math.min(durationSec, Math.floor(elapsed)))} / ${formatSec(durationSec)}`,
        elapsed / durationSec,
        true,
      );
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
    { class: 'screen calibration', 'aria-labelledby': 'cal-title' },
    topbar(),
    h(
      'div',
      { class: 'cal-head' },
      h('h1', { id: 'cal-title', class: 'hero' }, 'One-minute check-in'),
      h(
        'p',
        { class: 'lead' },
        'With light in front of you, Zwischenzug reads your resting pulse for a minute. ' +
          'That becomes your baseline.',
      ),
    ),
    h(
      'div',
      { class: 'cal-body' },
      camera.el,
      h(
        'div',
        { class: 'cal-main' },
        status.el,
        h('p', { class: 'readout' }, value, h('span', { class: 'readout-unit' }, 'bpm')),
        progress.el,
        keySlot,
        h(
          'div',
          { class: 'actions' },
          startBtn,
          h(
            'button',
            { onclick: () => void zz().giveConsent('timer-only') },
            'Use the timer instead',
          ),
        ),
        error,
        troubleshoot,
      ),
    ),
  );

  return {
    el,
    update(s: AppSnapshot) {
      durationSec = s.settings.calibrationSec;
      minSamples = s.settings.calibrationMinSamples;
      if (!s.presage.apiKeyConfigured && !keySlot.firstChild) keySlot.append(apiKeyForm().el);
      if (s.presage.apiKeyConfigured) keySlot.replaceChildren();
      startBtn.disabled = timer !== null || !s.presage.apiKeyConfigured || !s.presage.sdkLoaded;
      if (!s.presage.sdkLoaded && !s.presage.sdkError?.startsWith('loading')) {
        status.set('neutral', 'Unavailable', 'Pulse reading isn’t available on this computer.');
        troubleshoot.hidden = false;
      }
    },
    destroy: () => {
      if (timer !== null) window.clearInterval(timer);
      camera.video.srcObject = null;
      void provider.stop();
    },
  };
}
