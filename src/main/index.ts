import { app } from 'electron';
import { createAppWindow } from './window';
import { createLichessView } from './lichess/view';
import { logger } from './log';
import { runSmokeIfRequested } from './smoke';

const PANEL_WIDTH = 380;

app.enableSandbox();

app.whenReady().then(() => {
  const win = createAppWindow(() => false);
  const view = createLichessView(win, 'https://lichess.org');
  const layout = (): void => {
    const [width, height] = win.getContentSize() as [number, number];
    view.setBounds({ x: 0, y: 0, width: Math.max(0, width - PANEL_WIDTH), height });
  };
  win.on('resize', layout);
  layout();
  view.setVisible(true);
  runSmokeIfRequested(win, view);
  logger.info('app ready');
});

app.on('window-all-closed', () => app.quit());

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
});
