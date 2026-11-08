import type { ZzApi } from '../shared/ipc';
import type { AppSnapshot } from '../shared/types';

declare global {
  interface Window {
    zz: ZzApi;
  }
}

export const zz = (): ZzApi => window.zz;

type Child = Node | string | null | undefined | false;

/** Tiny element builder. Text is always set via text nodes, never innerHTML. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | ((e: Event) => void)> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === 'function') el.addEventListener(key.replace(/^on/, ''), value);
    else if (value === true) el.setAttribute(key, '');
    else if (value !== false) el.setAttribute(key, value);
  }
  for (const child of children) {
    if (child) el.append(child);
  }
  return el;
}

/** A mounted screen. `update` receives every snapshot while the screen is active. */
export interface View {
  el: HTMLElement;
  update(snapshot: AppSnapshot): void;
  destroy(): void;
}

export function staticView(el: HTMLElement): View {
  return { el, update: () => undefined, destroy: () => undefined };
}

/** The shared top bar: wordmark on the left, optional context on the right. */
export function topbar(...right: Child[]): HTMLElement {
  return h(
    'header',
    { class: 'topbar' },
    h('span', { class: 'wordmark' }, 'Zwischenzug'),
    ...right,
  );
}
