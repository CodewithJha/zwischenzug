import {
  app,
  dialog,
  ipcMain,
  systemPreferences,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { IPC, type Result } from '../shared/ipc';
import type { Config } from '../core/config';
import type { DiagnosticsInfo, PresageRendererConfig } from '../shared/types';
import { logger } from './log';
import { getPresageKey, savePresageKey } from './secrets';
import type { Session } from './session';
import { isAppPage } from './window';

const str = (v: unknown): string => (typeof v === 'string' ? v.slice(0, 500) : '');
const num = (v: unknown): number => (typeof v === 'number' ? v : NaN);

/** Rejects IPC from anything other than our bundled app page (defense in depth). */
function trusted(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? '';
  if (isAppPage(url)) return true;
  logger.warn('rejected IPC from untrusted frame');
  return false;
}

const denied: Result = { ok: false, error: 'untrusted sender' };

export function cameraPermission(): DiagnosticsInfo['cameraPermission'] {
  if (process.platform !== 'darwin' && process.platform !== 'win32') return 'unknown';
  return systemPreferences.getMediaAccessStatus('camera');
}

export function registerIpc(
  session: Session,
  config: Config,
  diagnostics: () => DiagnosticsInfo,
  openLichessLogin: () => void,
): void {
  const handle = (
    channel: string,
    fn: (...args: unknown[]) => unknown,
    fallback: unknown,
  ): void => {
    ipcMain.handle(channel, (event, ...args) => (trusted(event) ? fn(...args) : fallback));
  };
  const on = (channel: string, fn: (...args: unknown[]) => void): void => {
    ipcMain.on(channel, (event, ...args) => {
      if (trusted(event)) fn(...args);
    });
  };

  handle(IPC.getSnapshot, () => session.snapshot(), null);
  handle(
    IPC.giveConsent,
    (mode) =>
      mode === 'camera' || mode === 'timer-only'
        ? session.giveConsent(mode)
        : { ok: false, error: 'bad mode' },
    denied,
  );
  handle(IPC.setUsername, (name) => session.setUsername(str(name)), denied);
  handle(IPC.saveBaseline, (bpm, samples) => session.saveBaseline(num(bpm), num(samples)), denied);
  handle(IPC.recalibrate, () => session.recalibrate(), denied);
  handle(IPC.override, (sentence) => session.override(str(sentence)), denied);
  handle(IPC.getLog, () => session.getLog(), []);
  handle(IPC.deleteAll, () => session.deleteAll(), denied);
  handle(IPC.setDiagnostics, (open) => session.setDiagnostics(open === true), denied);
  handle(IPC.getDiagnostics, () => diagnostics(), null);
  handle(
    IPC.openLichessLogin,
    (): Result => {
      if (session.screen !== 'playing') return { ok: false, error: 'Not available right now.' };
      openLichessLogin();
      return { ok: true };
    },
    denied,
  );
  handle(
    IPC.exportLog,
    async (format): Promise<Result> => {
      const ext = format === 'json' ? 'json' : 'csv';
      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: path.join(app.getPath('documents'), `zwischenzug-games.${ext}`),
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
      });
      if (canceled || !filePath) return { ok: false, error: 'Export cancelled.' };
      try {
        writeFileSync(filePath, session.exportLog(ext));
        return { ok: true };
      } catch (err) {
        return { ok: false, error: `Could not save: ${String(err)}` };
      }
    },
    denied,
  );

  handle(
    IPC.requestCamera,
    async () => {
      if (!session.cameraAllowed) return false;
      if (process.platform !== 'darwin') return true;
      const status = cameraPermission();
      if (status === 'granted') return true;
      if (status === 'denied' || status === 'restricted') return false;
      return systemPreferences.askForMediaAccess('camera');
    },
    false,
  );

  handle(
    IPC.presageConfig,
    (): PresageRendererConfig | null => {
      if (!session.cameraAllowed) return null;
      const apiKey = getPresageKey();
      return apiKey ? { apiKey, enableTelemetry: config.presage.enableTelemetry } : null;
    },
    null,
  );
  handle(
    IPC.setPresageKey,
    (key): Result => {
      try {
        savePresageKey(str(key));
        session.notify();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    denied,
  );

  on(IPC.pulse, (bpm, stable) => session.pulse(num(bpm), stable === true));
  on(IPC.log, (level, message) => {
    const text = `[renderer] ${str(message)}`;
    if (level === 'error') logger.error(text);
    else if (level === 'warn') logger.warn(text);
    else logger.info(text);
  });
}
