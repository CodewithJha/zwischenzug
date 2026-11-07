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

export function formatSec(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
