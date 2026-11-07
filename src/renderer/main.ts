import type { AppSnapshot, Screen } from '../shared/types';
import { PresageProvider } from './biometrics/presage';
import { zz, type View } from './dom';
import { calibrationView } from './views/calibration';
import { consentView } from './views/consent';
import { cooldownView } from './views/cooldown';
import { diagnosticsView } from './views/diagnostics';
import { panelView } from './views/panel';
import { pulseMonitor } from './views/pulse-monitor';
import { setupView } from './views/setup';

let latest: AppSnapshot | null = null;
// The camera is only opened by the calibration and cooldown screens, and released when
// they are torn down (screen change), so it is never on during a game.
const provider = new PresageProvider(() => latest);

const VIEWS: Record<Screen, (s: AppSnapshot) => View> = {
  consent: consentView,
  setup: setupView,
  calibration: () => calibrationView(provider),
  playing: panelView,
  cooldown: (s) =>
    cooldownView(
      s.profile.consent?.mode === 'camera' && s.cooldown?.baselineBpm != null
        ? pulseMonitor(provider)
        : null,
    ),
  diagnostics: () => diagnosticsView(provider),
};

const root = document.getElementById('app') as HTMLElement;
let current: { screen: Screen; view: View } | null = null;

function render(s: AppSnapshot): void {
  latest = s;
  if (current?.screen !== s.screen) {
    current?.view.destroy();
    const view = VIEWS[s.screen](s);
    current = { screen: s.screen, view };
    document.body.dataset.screen = s.screen;
    root.replaceChildren(view.el);
  }
  current.view.update(s);
}

zz().onSnapshot(render);
void zz().getSnapshot().then(render);
window.addEventListener('error', (e) => zz().log('error', String(e.message)));
window.addEventListener('unhandledrejection', (e) => zz().log('error', String(e.reason)));
