import type { AppSnapshot, Screen } from '../shared/types';
import { h, staticView, zz, type View } from './dom';
import { consentView } from './views/consent';
import { cooldownView } from './views/cooldown';
import { panelView } from './views/panel';
import { setupView } from './views/setup';

const VIEWS: Record<Screen, () => View> = {
  consent: consentView,
  setup: setupView,
  calibration: () => staticView(h('section', { class: 'screen' }, 'Calibration (coming in M5)')),
  playing: panelView,
  cooldown: () => cooldownView(null),
};

const root = document.getElementById('app') as HTMLElement;
let current: { screen: Screen; view: View } | null = null;

function render(s: AppSnapshot): void {
  if (current?.screen !== s.screen) {
    current?.view.destroy();
    const view = VIEWS[s.screen]();
    current = { screen: s.screen, view };
    document.body.dataset.screen = s.screen;
    root.replaceChildren(view.el);
  }
  current.view.update(s);
}

zz().onSnapshot(render);
void zz().getSnapshot().then(render);
window.addEventListener('error', (e) => zz().log('error', String(e.message)));
