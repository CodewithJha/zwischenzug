import { app, type BrowserWindow } from 'electron';
import path from 'node:path';
import { logger } from './log';

export interface PresageStatus {
  sdkLoaded: boolean;
  sdkError: string | null;
  sdkVersion: string | null;
}

const NATIVE_LIB: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'libsmartspectra_capi.dylib',
  win32: 'smartspectra_capi.dll',
  linux: 'libsmartspectra_capi.so',
};

/** SDK instances (main side of the bridge) whose native session may not be torn down yet. */
const started = new Set<{ destroy(): Promise<void> }>();

/**
 * Destroys every native session and waits for its teardown. Must finish before Node shuts
 * down: koffi fires a JS callback when a session's async destroy/stop completes, and that
 * callback aborts the process (napi_throw) if it lands during environment cleanup.
 */
export async function shutdownPresage(): Promise<void> {
  const pending = [...started];
  if (pending.length === 0) return;
  const t0 = Date.now();
  await Promise.allSettled(pending.map((sdk) => sdk.destroy()));
  logger.info(`SmartSpectra: ${pending.length} session(s) torn down in ${Date.now() - t0} ms`);
}

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
    const { bindSmartSpectraIpc, SmartSpectraSDK } = await import('@smartspectra/node-sdk/main');
    // ponytail: the IPC glue keeps its SDK instances private and exposes no dispose, so track
    // them by wrapping the prototype. Revisit if the SDK adds a shutdown API.
    const proto = SmartSpectraSDK.prototype;
    const { start, destroy } = proto;
    proto.start = function () {
      started.add(this);
      return start.call(this);
    };
    proto.destroy = function () {
      const done = destroy.call(this);
      void done.finally(() => started.delete(this));
      return done;
    };
    bindSmartSpectraIpc(win, {
      logger: (level, msg) => logger[level](`[smartspectra] ${msg}`),
    });
    logger.info(`SmartSpectra SDK ${SmartSpectraSDK.version} loaded and bound`);
    return { sdkLoaded: true, sdkError: null, sdkVersion: SmartSpectraSDK.version };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`SmartSpectra SDK unavailable: ${message}`);
    return {
      sdkLoaded: false,
      sdkError: `SDK could not load on this machine (${message.slice(0, 160)})`,
      sdkVersion: null,
    };
  }
}
