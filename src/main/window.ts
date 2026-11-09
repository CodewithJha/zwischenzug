import { app, BrowserWindow, session } from 'electron';
import path from 'node:path';
import { logger } from './log';

const RENDERER_HTML = path.join(__dirname, '../renderer/index.html');
const PRELOAD = path.join(__dirname, '../preload/index.js');

export function isAppPage(url: string): boolean {
  return url.startsWith('file://') && decodeURIComponent(url).includes('/renderer/index.html');
}

/**
 * The app window hosts our own UI (consent, calibration, cooldown, log).
 * Camera permission is granted only to our bundled page, video only, and only after consent.
 */
export function createAppWindow(canUseCamera: () => boolean): BrowserWindow {
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const url = details.requestingUrl || wc.getURL();
    const mediaTypes = 'mediaTypes' in details ? (details.mediaTypes ?? []) : [];
    const videoOnly = mediaTypes.length === 1 && mediaTypes[0] === 'video';
    const allowed = permission === 'media' && videoOnly && isAppPage(url) && canUseCamera();
    if (permission === 'media')
      logger.info(`camera permission request: ${allowed ? 'granted' : 'denied'}`);
    callback(allowed);
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => {
    return permission === 'media' && origin.startsWith('file://') && canUseCamera();
  });

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#0a0a0a',
    title: 'Zwischenzug',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  void win.loadFile(RENDERER_HTML);
  if (process.env.ZZ_DEVTOOLS === '1' && !app.isPackaged)
    win.webContents.openDevTools({ mode: 'detach' });
  return win;
}
