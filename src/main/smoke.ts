import { app, BrowserWindow, WebContentsView } from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { logger } from './log';

/**
 * `ZZ_SMOKE_DIR=/tmp/zz npm start` loads the app, waits for Lichess, writes PNG captures
 * of both surfaces plus a JSON report into that directory, then quits. Used for headless-ish
 * verification without screen-recording permissions.
 */
export function runSmokeIfRequested(win: BrowserWindow, view: WebContentsView): void {
  const dir = process.env.ZZ_SMOKE_DIR;
  if (!dir) return;
  const finish = async (): Promise<void> => {
    await new Promise((r) => setTimeout(r, 4000));
    const [appImg, lichessImg] = await Promise.all([
      win.webContents.capturePage(),
      view.webContents.capturePage(),
    ]);
    await writeFile(path.join(dir, 'app.png'), appImg.toPNG());
    await writeFile(path.join(dir, 'lichess.png'), lichessImg.toPNG());
    const report = {
      lichessUrl: view.webContents.getURL(),
      lichessTitle: view.webContents.getTitle(),
      lichessVisible: view.getVisible(),
      appText: await win.webContents.executeJavaScript('document.body.innerText'),
      lichessHasPreloadApi: await view.webContents.executeJavaScript('typeof window.zz'),
      appHasPreloadApi: await win.webContents.executeJavaScript('typeof window.zz'),
    };
    await writeFile(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
    logger.info(`smoke report written to ${dir}`);
    app.quit();
  };
  view.webContents.once('did-finish-load', () => void finish());
}
