import { app, type BrowserWindow } from 'electron';
import path from 'node:path';
import { logger } from './log';

export interface PresageStatus {
  sdkLoaded: boolean;
  sdkError: string | null;
}

const NATIVE_LIB: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'libsmartspectra_capi.dylib',
  win32: 'smartspectra_capi.dll',
  linux: 'libsmartspectra_capi.so',
};

/**
 * Loads the SmartSpectra native runtime and binds its IPC to the app window (the official
 * Electron integration: renderer captures frames, main runs the native SDK). Failure is
 * reported, not thrown: the app then runs with the timer fallback.
 */
export async function initPresage(win: BrowserWindow): Promise<PresageStatus> {
  if (app.isPackaged) {
    // .dylib/.dll/.so cannot load from inside app.asar; electron-builder copies the native
    // closure to resources/smartspectra. Set unconditionally so the env can't redirect it.
    const lib = NATIVE_LIB[process.platform];
    if (lib)
      process.env.SMARTSPECTRA_CAPI_PATH = path.join(process.resourcesPath, 'smartspectra', lib);
  }
  try {
    // Loading this module loads the native library (koffi), so do it lazily.
    const { bindSmartSpectraIpc } = await import('@smartspectra/node-sdk/main');
    bindSmartSpectraIpc(win, {
      logger: (level, msg) => logger[level](`[smartspectra] ${msg}`),
    });
    logger.info('SmartSpectra SDK loaded and bound');
    return { sdkLoaded: true, sdkError: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`SmartSpectra SDK unavailable: ${message}`);
    return {
      sdkLoaded: false,
      sdkError: `SDK could not load on this machine (${message.slice(0, 160)})`,
    };
  }
}
