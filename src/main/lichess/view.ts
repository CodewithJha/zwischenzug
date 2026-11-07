import { BrowserWindow, WebContentsView, session, shell } from 'electron';
import { isLichessUrl } from '../../core/lichess-url';
import { logger } from '../log';

export const LICHESS_PARTITION = 'persist:lichess';

function openExternally(url: string): void {
  if (/^https?:\/\//.test(url)) void shell.openExternal(url);
}

/**
 * Creates the Lichess view: its own persistent session (cookies separate from the app),
 * no preload, sandboxed, and top-level navigation restricted to lichess.org.
 */
export function createLichessView(win: BrowserWindow, startUrl: string): WebContentsView {
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
  void wc.loadURL(startUrl).catch((err: unknown) => {
    logger.warn(`lichess load failed: ${String(err)}`);
  });
  return view;
}
