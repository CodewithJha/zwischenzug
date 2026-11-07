import type { AppSnapshot } from '../../shared/types';
import type { BiometricProvider } from '../biometrics/provider';
import { h, zz, type View } from '../dom';

/**
 * Live pulse panel inside the cooldown screen. Owns the camera for the cooldown's lifetime
 * and forwards readings to main, which decides the unlock.
 */
export function pulseMonitor(provider: BiometricProvider): View {
  const video = h('video', { class: 'preview', muted: true, autoplay: true, playsinline: true });
  const live = h('div', { class: 'bpm' }, '–');
  const target = h('div', { class: 'muted' });
  const hint = h('p', { class: 'hint' }, 'Starting camera...');
  let lastBpm: number | null = null;
  let unavailable = false;

  void provider.start({
    reading: (r) => {
      zz().reportPulse(r.bpm, r.stable);
      if (r.stable) lastBpm = r.bpm;
    },
    state: (s) => {
      unavailable = s.kind === 'unavailable';
      hint.className = `hint ${s.kind === 'measuring' && s.ok ? 'ok' : 'warn'}`;
      if (s.kind === 'starting') hint.textContent = 'Starting camera...';
      else if (s.kind === 'measuring')
        hint.textContent = s.ok ? 'Reading your pulse. Stay relaxed.' : (s.hint ?? 'Adjusting...');
      else hint.textContent = `${s.reason} The timer will unlock instead.`;
    },
    stream: (stream) => {
      video.srcObject = stream;
      void video.play().catch(() => undefined);
    },
  });

  return {
    el: h(
      'div',
      { class: 'monitor' },
      video,
      h('div', {}, h('div', { class: 'muted' }, 'Your pulse now'), live, target, hint),
    ),
    update(s: AppSnapshot) {
      const c = s.cooldown;
      live.textContent =
        c?.lastBpm != null
          ? `${Math.round(c.lastBpm)} bpm`
          : unavailable || lastBpm === null
            ? '–'
            : '…';
      target.textContent =
        c?.baselineBpm != null
          ? `Your baseline ${c.baselineBpm} · settled at or below ${c.upperBandBpm}`
          : '';
    },
    destroy: () => {
      video.srcObject = null;
      void provider.stop();
    },
  };
}
