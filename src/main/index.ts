import { app } from 'electron';
import path from 'node:path';
import { IPC } from '../shared/ipc';
import { freshState, parseLog, parseState } from '../core/persisted';
import { loadConfig } from './config';
import { registerIpc } from './ipc';
import { createLichessView } from './lichess/view';
import { logger } from './log';
import { getPresageKey } from './secrets';
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
  const session = new Session({
    config,
    stateFile: new JsonFile(
      path.join(dataDir, 'state.json'),
      (raw) => parseState(raw, Date.now()),
      freshState,
    ),
    logFile: new JsonFile(path.join(dataDir, 'games.json'), parseLog, () => ({
      version: 1 as const,
      games: [],
    })),
    presageStatus: () => ({ sdkLoaded: false, sdkError: 'Presage integration not wired yet' }),
    hasApiKey: () => getPresageKey() !== null,
  });
  registerIpc(session, config);

  const win = createAppWindow(() => session.cameraAllowed);
  const view = createLichessView(win, config.lichess.origin);

  const render = (): void => {
    const showLichess = session.screen === 'playing';
    const [width, height] = win.getContentSize() as [number, number];
    view.setBounds({ x: 0, y: 0, width: Math.max(0, width - PANEL_WIDTH), height });
    view.setVisible(showLichess);
    if (!win.webContents.isLoading()) win.webContents.send(IPC.snapshot, session.snapshot());
  };
  session.onChange(render);
  win.on('resize', render);
  win.webContents.on('did-finish-load', render);
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
