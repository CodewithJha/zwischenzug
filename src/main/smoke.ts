import { app, BrowserWindow, WebContentsView } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { logger } from './log';

/**
 * Verification aid. `ZZ_SMOKE_DIR=/tmp/zz npm start` waits for both surfaces to load, then
 * runs the optional `ZZ_SMOKE_STEPS` (JSON array of {name, js} evaluated in the app page),
 * capturing PNGs and a JSON report after each step, then quits.
 * Never active unless the env var is set, and never in packaged builds.
 */
export function runSmokeIfRequested(win: BrowserWindow, view: WebContentsView): void {
  const dir = process.env.ZZ_SMOKE_DIR;
  if (!dir || app.isPackaged) return;
  mkdirSync(dir, { recursive: true });
  // Scripted runs must not be steered by (or steal) the real mouse.
  win.setIgnoreMouseEvents(true);
  win.blur();
  // Scripted steps evaluate arbitrary JS, so they are a development-only feature.
  const stepsJson = app.isPackaged ? '[]' : (process.env.ZZ_SMOKE_STEPS ?? '[]');
  const steps = JSON.parse(stepsJson) as {
    name: string;
    js: string;
    target?: 'app' | 'lichess';
    waitMs?: number;
  }[];
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  const report: Record<string, unknown>[] = [];

  const capture = async (name: string): Promise<void> => {
    await wait(1500);
    writeFileSync(path.join(dir, `${name}-app.png`), (await win.webContents.capturePage()).toPNG());
    if (view.getVisible()) {
      writeFileSync(
        path.join(dir, `${name}-lichess.png`),
        (await view.webContents.capturePage()).toPNG(),
      );
    }
    report.push({
      step: name,
      screen: await win.webContents.executeJavaScript('document.body.dataset.screen'),
      appText: await win.webContents.executeJavaScript('document.body.innerText'),
      lichessVisible: view.getVisible(),
      lichessUrl: view.webContents.getURL(),
      lichessHasZzApi: await view.webContents.executeJavaScript('typeof window.zz'),
      lichessHasSdkBridge: await view.webContents.executeJavaScript(
        'typeof window.__smartspectraBridge',
      ),
    });
  };

  const run = async (): Promise<void> => {
    await wait(2500);
    await capture('start');
    for (const s of steps) {
      if (s.waitMs) await wait(s.waitMs);
      try {
        const wc = s.target === 'lichess' ? view.webContents : win.webContents;
        const result: unknown = await wc.executeJavaScript(s.js);
        report.push({ step: `${s.name}:result`, result });
      } catch (err) {
        report.push({ step: `${s.name}:error`, error: String(err) });
      }
      await capture(s.name);
    }
    writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
    logger.info(`smoke report written to ${dir}`);
    app.quit();
  };
  // `ZZ_SMOKE_OFFLINE_MS`: lichess.org is unreachable (an unroutable proxy) for that long.
  const offlineMs = app.isPackaged ? 0 : Number(process.env.ZZ_SMOKE_OFFLINE_MS ?? 0);
  if (offlineMs > 0) {
    const ses = view.webContents.session;
    void ses.setProxy({ proxyRules: 'http://127.0.0.1:9' }).then(() => {
      void view.webContents.loadURL('https://lichess.org/').catch(() => undefined);
      setTimeout(() => void ses.setProxy({ mode: 'direct' }), offlineMs);
      void run();
    });
    return;
  }
  view.webContents.once('did-finish-load', () => void run());
}
