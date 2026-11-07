import { app, powerMonitor } from 'electron';
import path from 'node:path';
import { steadyClock } from '../core/clock';
import { IPC } from '../shared/ipc';
import { freshState, parseLog, parseState } from '../core/persisted';
import { loadConfig } from './config';
import { cameraPermission, registerIpc } from './ipc';
import { installRequestLock } from './lichess/lock';
import { LichessGameSource } from './lichess/source';
import { createLichessView } from './lichess/view';
import { logger } from './log';
import { initPresage, type PresageStatus } from './presage';
import { presageKeySource } from './secrets';
import { Session } from './session';
import { runSmokeIfRequested } from './smoke';
import { JsonFile } from './store';
import { createAppWindow } from './window';

/** Width of the app's side panel while Lichess is visible. */
const PANEL_WIDTH = 380;

app.enableSandbox();
if (process.env.ZZ_USER_DATA_DIR) app.setPath('userData', process.env.ZZ_USER_DATA_DIR);

app.whenReady().then(() => {
  const config = loadConfig();
  const dataDir = app.getPath('userData');
  const clock = steadyClock(Date.now, () => performance.now());
  powerMonitor.on('resume', clock.resync);
  let presage: PresageStatus = { sdkLoaded: false, sdkError: 'loading...', sdkVersion: null };
  const session = new Session({
    config,
    now: clock.now,
    stateFile: new JsonFile(
      path.join(dataDir, 'state.json'),
      (raw) => parseState(raw, clock.now()),
      freshState,
    ),
    logFile: new JsonFile(path.join(dataDir, 'games.json'), parseLog, () => ({
      version: 1 as const,
      games: [],
    })),
    presageStatus: () => ({ sdkLoaded: presage.sdkLoaded, sdkError: presage.sdkError }),
    hasApiKey: () => presageKeySource() !== null,
  });
  registerIpc(session, config, () => ({
    apiKeySource: presageKeySource(),
    cameraPermission: cameraPermission(),
    sdkVersion: presage.sdkVersion,
    electronVersion: process.versions.electron,
    platform: `${process.platform}-${process.arch}`,
    packaged: app.isPackaged,
  }));

  const win = createAppWindow(() => session.cameraAllowed);
  void initPresage(win).then((status) => {
    presage = status;
    session.notify();
  });
  const view = createLichessView(win, config.lichess.origin);
  installRequestLock(view.webContents.session, () => session.locked);

  const games = new LichessGameSource(config.lichess, {
    finished: (game) => session.gameFinished(game),
    status: (status) => session.setLichessStatus(status),
  });
  const noteUrl = (_e: unknown, url: string): void => games.noteUrl(url);
  view.webContents.on('did-navigate', noteUrl);
  view.webContents.on('did-navigate-in-page', noteUrl);

  let watched: string | null = null;
  const syncGameSource = (): void => {
    if (session.username === watched) return;
    watched = session.username;
    if (watched) games.start(watched);
    else games.stop();
  };

  const render = (): void => {
    const showLichess = session.screen === 'playing';
    const [width, height] = win.getContentSize() as [number, number];
    view.setBounds({ x: 0, y: 0, width: Math.max(0, width - PANEL_WIDTH), height });
    view.setVisible(showLichess);
    // A hidden view can keep keyboard focus; move it so keys cannot reach Lichess.
    if (!showLichess && view.webContents.isFocused()) win.webContents.focus();
    if (!win.webContents.isLoading()) win.webContents.send(IPC.snapshot, session.snapshot());
  };
  session.onChange(syncGameSource);
  session.onChange(render);
  win.on('resize', render);
  win.webContents.on('did-finish-load', render);
  syncGameSource();
  render();

  const ticker = setInterval(() => session.tick(), 1000);
  win.on('closed', () => clearInterval(ticker));

  runSmokeIfRequested(win, view);
  logger.info(`app ready (screen=${session.screen})`);
});

app.on('window-all-closed', () => app.quit());

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
});
