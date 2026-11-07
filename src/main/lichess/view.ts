import { BrowserWindow, WebContentsView, session, shell, type WebContents } from 'electron';
import { isLichessUrl } from '../../core/lichess-url';
import { isRetryableLoadFailure, retryDelayMs } from '../../core/load-retry';
import type { AppSnapshot } from '../../shared/types';
import { logger } from '../log';

export const LICHESS_PARTITION = 'persist:lichess';

function openExternally(url: string): void {
  if (/^https?:\/\//.test(url)) void shell.openExternal(url);
}

/**
 * Creates the Lichess view: its own persistent session (cookies separate from the app),
 * no preload, sandboxed, and top-level navigation restricted to lichess.org.
 */
export function createLichessView(
  win: BrowserWindow,
  startUrl: string,
  onPage: (page: AppSnapshot['lichessPage']) => void,
): { view: WebContentsView; retryLoad: () => void } {
  const ses = session.fromPartition(LICHESS_PARTITION);
  // Lichess needs no device permissions; deny camera, mic, notifications, etc.
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);

  const view = new WebContentsView({
    webPreferences: {
      partition: LICHESS_PARTITION,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      safeDialogs: true,
      // A DevTools window opened while playing would stay usable during a cooldown.
      devTools: false,
    },
  });
  const wc = view.webContents;

  const guard = (event: Electron.Event, url: string): void => {
    if (isLichessUrl(url)) return;
    event.preventDefault();
    logger.info('blocked off-site navigation; opening externally');
    openExternally(url);
  };
  wc.on('will-navigate', guard);
  wc.on('will-redirect', guard);
  wc.setWindowOpenHandler(({ url }) => {
    if (isLichessUrl(url)) void wc.loadURL(url);
    else openExternally(url);
    return { action: 'deny' };
  });
  wc.on('will-attach-webview', (event) => event.preventDefault());
  wc.on('render-process-gone', (_e, details) => {
    logger.warn(`lichess renderer gone: ${details.reason}`);
  });

  win.contentView.addChildView(view);
  view.setVisible(false);
  const retryLoad = keepLoaded(wc, startUrl, onPage);
  void wc.loadURL(startUrl).catch(() => undefined); // failures arrive as did-fail-load
  return { view, retryLoad };
}

/**
 * Reloads after a failed main-frame load (2s, 5s, 10s, then every 30s) until one succeeds.
 * Only loads the page: visibility and the request lock stay with the caller.
 */
function keepLoaded(
  wc: WebContents,
  fallbackUrl: string,
  onPage: (page: AppSnapshot['lichessPage']) => void,
): () => void {
  let failures = 0;
  let failedThisLoad = false;
  let url = fallbackUrl;
  let timer: NodeJS.Timeout | undefined;
  const load = (): void => {
    clearTimeout(timer);
    void wc.loadURL(url).catch(() => undefined);
  };
  wc.on('did-start-loading', () => (failedThisLoad = false));
  wc.on('did-fail-load', (_e, code, description, failedUrl, isMainFrame) => {
    if (!isRetryableLoadFailure(code, isMainFrame)) return;
    failedThisLoad = true;
    failures += 1;
    url = isLichessUrl(failedUrl) ? failedUrl : fallbackUrl;
    const delay = retryDelayMs(failures);
    logger.warn(`lichess load failed: ${description} (${code}); retry in ${delay / 1000}s`);
    clearTimeout(timer);
    timer = setTimeout(load, delay);
    onPage({ status: 'failed', error: description, retryAt: Date.now() + delay });
  });
  // Chromium's error page also fires dom-ready, just after did-fail-load.
  wc.on('dom-ready', () => {
    if (failedThisLoad || failures === 0) return;
    logger.info(`lichess loaded after ${failures} failed attempt(s)`);
    failures = 0;
    clearTimeout(timer);
    onPage({ status: 'ok' });
  });
  return () => {
    if (failures > 0) load();
  };
}
