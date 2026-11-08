import { app, powerMonitor } from 'electron';
import path from 'node:path';
import { steadyClock } from '../core/clock';
import { IPC } from '../shared/ipc';
import { freshState, parseLog, parseState } from '../core/persisted';
import { quitAfter } from '../core/quit-guard';
import { loadConfig } from './config';
import { cameraPermission, registerIpc } from './ipc';
import { watchLichessIdentity } from './lichess/identity';
import { installRequestLock } from './lichess/lock';
import { LichessGameSource } from './lichess/source';
import { createLichessView } from './lichess/view';
import { logger } from './log';
import { initPresage, shutdownPresage, type PresageStatus } from './presage';
import { presageKeySource } from './secrets';
import { Session } from './session';
import { runSmokeIfRequested } from './smoke';
import { JsonFile } from './store';
import { createAppWindow } from './window';

/** Width of the app's side panel while Lichess is visible. */
const PANEL_WIDTH = 380;
/** Height of the sign-in bar above Lichess (matches --bar-height in styles.css). */
const BAR_HEIGHT = 56;
/** Longest a quit waits for the Presage native session to tear down (measured ~2.7 s). */
const QUIT_DRAIN_MS = 10_000;

// Before ready and before userData is resolved: menu items and the default data folder use it.
app.setName('Zwischenzug');
app.enableSandbox();
if (process.env.ZZ_USER_DATA_DIR) app.setPath('userData', process.env.ZZ_USER_DATA_DIR);
// Scripted smoke runs must never open the real camera; Chromium substitutes a test pattern.
if (process.env.ZZ_SMOKE_DIR && !app.isPackaged) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
}
// One instance per data folder: two would race on state.json and both watch Lichess.
if (!app.requestSingleInstanceLock()) app.exit(0);

app.whenReady().then(() => {
  // Packaged builds get the icon from the bundle; in dev the dock would show Electron's.
  if (!app.isPackaged) app.dock?.setIcon(path.join(app.getAppPath(), 'build', 'icon.png'));
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
  const win = createAppWindow(() => session.cameraAllowed);
  app.on('second-instance', () => {
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  void initPresage(win).then((status) => {
    presage = status;
    session.notify();
  });
  const { view, retryLoad } = createLichessView(win, config.lichess.origin, (page) =>
    session.setLichessPage(page),
  );
  installRequestLock(view.webContents.session, () => session.playBlocked);
  const identity = watchLichessIdentity(view.webContents.session, config.lichess.origin, (obs) =>
    session.setIdentity(obs),
  );

  registerIpc(
    session,
    config,
    () => ({
      apiKeySource: presageKeySource(),
      cameraPermission: cameraPermission(),
      sdkVersion: presage.sdkVersion,
      electronVersion: process.versions.electron,
      platform: `${process.platform}-${process.arch}`,
      packaged: app.isPackaged,
    }),
    () => void view.webContents.loadURL(`${config.lichess.origin}/login`),
    retryLoad,
  );

  const games = new LichessGameSource(config.lichess, {
    finished: (game) => session.gameFinished(game),
    status: (status) => session.setLichessStatus(status),
  });
  const noteUrl = (_e: unknown, url: string): void => {
    games.noteUrl(url);
    identity.recheck();
  };
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
    // A failed load leaves a blank page; hide it so the app's "couldn't reach" notice shows.
    const showLichess = session.screen === 'playing' && !session.lichessPageFailed;
    const [width, height] = win.getContentSize() as [number, number];
    // Room above Lichess for the app's "sign in as @user" bar while play is not allowed.
    const top = showLichess && !session.identityVerified ? BAR_HEIGHT : 0;
    view.setBounds({
      x: 0,
      y: top,
      width: Math.max(0, width - PANEL_WIDTH),
      height: Math.max(0, height - top),
    });
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
quitAfter(app, shutdownPresage, QUIT_DRAIN_MS);

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
});
