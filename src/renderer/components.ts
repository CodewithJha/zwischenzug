import { h } from './dom';

export type DotKind = 'live' | 'warn' | 'idle' | 'neutral';

/** Dot + bold title + plain detail. Announced politely as a status. */
export function statusLine(): {
  el: HTMLElement;
  set(dot: DotKind, title: string, detail: string): void;
} {
  const dot = h('span', { class: 'dot', 'aria-hidden': 'true' });
  const title = h('strong');
  const detail = h('span');
  const el = h('p', { class: 'status', role: 'status' }, dot, title, detail);
  return {
    el,
    set(kind, t, d) {
      dot.className = kind === 'neutral' ? 'dot' : `dot ${kind}`;
      title.textContent = t;
      detail.textContent = d;
    },
  };
}

/** Label and value over a thin track. The native <progress> keeps the value accessible. */
export function meter(): {
  el: HTMLElement;
  set(label: string, value: string, fraction: number, live?: boolean): void;
} {
  const label = h('span', { class: 'meter-label' });
  const value = h('span', { class: 'meter-value' });
  const bar = h('progress', { max: '1', value: '0' });
  const el = h('div', { class: 'meter' }, label, value, bar);
  return {
    el,
    set(l, v, fraction, live = false) {
      label.textContent = l;
      value.textContent = v;
      bar.value = Math.max(0, Math.min(1, fraction));
      bar.setAttribute('aria-label', `${l}: ${v}`);
      el.classList.toggle('live', live);
    },
  };
}

/** Mirrored camera preview with a one-line caption. */
export function cameraPreview(): {
  el: HTMLElement;
  video: HTMLVideoElement;
  caption(text: string): void;
} {
  const video = h('video', { class: 'preview', muted: true, autoplay: true, playsinline: true });
  const cap = h('figcaption');
  return {
    el: h('figure', { class: 'camera' }, video, cap),
    video,
    caption: (text) => (cap.textContent = text),
  };
}
