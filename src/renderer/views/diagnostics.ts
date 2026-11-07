import { readingStats } from '../../core/pulse';
import type { AppSnapshot, DiagnosticsInfo } from '../../shared/types';
import type { BiometricProvider, PulseReading } from '../biometrics/provider';
import { h, zz, type View } from '../dom';

const KEY_LABEL = { env: 'yes (PRESAGE_API_KEY)', saved: 'yes (saved in the app)' } as const;
const MAX_ROWS = 15;

const clock = (ms: number): string =>
  new Date(ms).toLocaleTimeString([], { hour12: false }) +
  `.${String(Math.floor(ms % 1000)).padStart(3, '0')}`;

/**
 * Presage SDK diagnostics: environment facts and a live measurement that shows raw readings.
 * Readings stay on this screen; they are never reported to main, logged or stored.
 */
export function diagnosticsView(provider: BiometricProvider): View {
  const facts = h('dl', { class: 'facts' });
  const readiness = h('p', { class: 'badge' });
  const mode = h('p', { class: 'badge', role: 'status' });
  const hint = h('p', { class: 'hint' });
  const stats = h('p', { class: 'stats' });
  const rows = h('tbody');
  const events = h('ol', { class: 'events' });
  const video = h('video', { class: 'preview', muted: true, autoplay: true, playsinline: true });
  const startBtn = h('button', { class: 'primary' }, 'Start measurement');
  const stopBtn = h('button', { disabled: true }, 'Stop');

  let latest: AppSnapshot | null = null;
  let info: DiagnosticsInfo | null = null;
  let running = false;
  let startedAt = 0;
  let received: { at: number; stable: boolean }[] = [];
  let statsTimer: number | null = null;

  const setMode = (text: string, kind: 'real' | 'fallback' | 'idle'): void => {
    mode.textContent = text;
    mode.className = `badge ${kind}`;
  };

  const renderFacts = (): void => {
    const s = latest;
    const p = s?.presage;
    const cameraMode = s?.profile.consent?.mode === 'camera';
    const items: [string, string][] = [
      ['SDK', p?.sdkLoaded ? `loaded (v${info?.sdkVersion ?? '?'})` : `not loaded: ${p?.sdkError}`],
      ['API key present', info?.apiKeySource ? KEY_LABEL[info.apiKeySource] : 'no'],
      ['Camera permission (OS)', info?.cameraPermission ?? '?'],
      ['Consent mode', cameraMode ? 'camera between games' : 'timer only (camera off)'],
      [
        'Runtime',
        info
          ? `Electron ${info.electronVersion} · ${info.platform} · ${info.packaged ? 'packaged' : 'dev'}`
          : '?',
      ],
    ];
    facts.replaceChildren(...items.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
    const ready = p?.sdkLoaded && info?.apiKeySource && cameraMode;
    readiness.textContent = ready
      ? 'Cooldowns will use: REAL SDK (pulse), timer if the signal drops'
      : 'Cooldowns will use: FALLBACK (timer only)';
    readiness.className = `badge ${ready ? 'real' : 'fallback'}`;
    startBtn.disabled = running || !ready;
  };

  const refreshInfo = async (): Promise<void> => {
    info = await zz().getDiagnostics();
    renderFacts();
  };

  const trace = (message: string): void => {
    const t = ((Date.now() - startedAt) / 1000).toFixed(1);
    events.prepend(h('li', {}, `+${t}s ${message}`));
    while (events.children.length > 30) events.lastElementChild?.remove();
  };

  const renderStats = (): void => {
    const st = readingStats(startedAt, received, Date.now());
    stats.textContent =
      `Readings: ${st.count} · first after ` +
      `${st.firstAfterSec === null ? '–' : `${st.firstAfterSec.toFixed(1)} s`} · ` +
      `${st.perSec === null ? '–' : st.perSec.toFixed(2)} / s · stable ` +
      `${st.stableShare === null ? '–' : `${Math.round(st.stableShare * 100)}%`}`;
  };

  const reading = (r: PulseReading): void => {
    const at = Date.now();
    received.push({ at, stable: r.stable });
    rows.prepend(
      h(
        'tr',
        {},
        h('td', {}, clock(at)),
        h('td', {}, r.measuredAt ? clock(r.measuredAt) : '–'),
        h('td', {}, r.bpm.toFixed(1)),
        h('td', {}, r.confidence === undefined ? '–' : r.confidence.toFixed(0)),
        h('td', {}, r.stable ? 'yes' : 'no'),
      ),
    );
    while (rows.children.length > MAX_ROWS) rows.lastElementChild?.remove();
    renderStats();
  };

  const stopTimer = (): void => {
    if (statsTimer !== null) window.clearInterval(statsTimer);
    statsTimer = null;
  };

  const stop = async (): Promise<void> => {
    running = false;
    stopTimer();
    stopBtn.disabled = true;
    await provider.stop();
    video.srcObject = null;
    if (!mode.classList.contains('fallback')) setMode('Stopped. Camera off.', 'idle');
    void refreshInfo();
  };

  const start = (): void => {
    running = true;
    startedAt = Date.now();
    received = [];
    rows.replaceChildren();
    events.replaceChildren();
    hint.textContent = '';
    renderStats();
    startBtn.disabled = true;
    stopBtn.disabled = false;
    setMode('Starting...', 'idle');
    statsTimer = window.setInterval(renderStats, 1000);
    void provider.start({
      reading,
      trace,
      state: (s) => {
        if (s.kind === 'starting') return;
        if (s.kind === 'measuring') {
          setMode('REAL SDK: Presage session running', 'real');
          hint.textContent = s.ok ? 'Signal OK' : (s.hint ?? 'Adjusting...');
          hint.className = `hint ${s.ok ? 'ok' : 'warn'}`;
          return;
        }
        setMode(`FALLBACK: ${s.reason} Cooldowns would use the timer.`, 'fallback');
        running = false;
        stopTimer();
        stopBtn.disabled = true;
        video.srcObject = null;
        void refreshInfo();
      },
      stream: (stream) => {
        video.srcObject = stream;
        void video.play().catch(() => undefined);
      },
    });
  };

  startBtn.addEventListener('click', start);
  stopBtn.addEventListener('click', () => void stop());
  setMode('Idle. Camera off.', 'idle');
  void refreshInfo();

  const el = h(
    'section',
    { class: 'screen diagnostics' },
    h('h1', {}, 'Presage diagnostics'),
    h(
      'p',
      { class: 'muted' },
      'Checks the SmartSpectra SDK on this machine. Readings shown here are not saved and do ' +
        'not affect any cooldown. The camera turns off when you stop or leave this screen.',
    ),
    facts,
    readiness,
    h(
      'div',
      { class: 'actions' },
      startBtn,
      stopBtn,
      h('button', { onclick: () => void zz().setDiagnostics(false) }, 'Back'),
    ),
    mode,
    h('div', { class: 'monitor' }, video, h('div', {}, hint, stats)),
    h('h2', {}, 'Latest readings'),
    h(
      'table',
      { class: 'readings' },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          ...['Received', 'Measured', 'BPM', 'Confidence', 'Stable'].map((c) => h('th', {}, c)),
        ),
      ),
      rows,
    ),
    h('h2', {}, 'SDK events'),
    events,
  );

  return {
    el,
    update(s: AppSnapshot) {
      latest = s;
      renderFacts();
    },
    destroy: () => {
      stopTimer();
      video.srcObject = null;
      void provider.stop();
    },
  };
}
