import {
  MetricType,
  ProcessingStatus,
  SmartSpectraErrorCode,
  SmartSpectraSDK,
  ValidationCode,
} from '@smartspectra/node-sdk/renderer';
import { decodeMetrics } from '@smartspectra/node-sdk/messages';
import type { AppSnapshot } from '../../shared/types';
import { zz } from '../dom';
import type { BiometricProvider, ProviderHandlers } from './provider';

const HINTS: Partial<Record<number, string>> = {
  [ValidationCode.kNoFaceFound]: 'No face in view. Face the camera.',
  [ValidationCode.kMultipleFacesFound]: 'More than one face in view.',
  [ValidationCode.kFaceNotCentered]: 'Center your face in the camera.',
  [ValidationCode.kFaceSizeOutOfRange]: 'Move a little closer or further away.',
  [ValidationCode.kFaceTooClose]: 'A little further from the camera.',
  [ValidationCode.kFaceTooFar]: 'A little closer to the camera.',
  [ValidationCode.kFaceTooHigh]: 'Lower your face in the frame.',
  [ValidationCode.kFaceTooLow]: 'Raise your face in the frame.',
  [ValidationCode.kFaceNotForward]: 'Look toward the screen.',
  [ValidationCode.kTooDark]: 'Too dark. Add light in front of you.',
  [ValidationCode.kTooBright]: 'Too bright. Avoid direct light into the camera.',
  [ValidationCode.kExcessiveMotion]: 'Hold still for a moment.',
  [ValidationCode.kCameraTuning]: 'Adjusting the camera...',
  [ValidationCode.kFrameRateTooLow]: 'Camera frame rate too low.',
};

const ERRORS: Partial<Record<number, string>> = {
  [SmartSpectraErrorCode.kAuthenticationFailed]: 'Presage rejected the API key.',
  [SmartSpectraErrorCode.kCreditExhausted]: 'Presage credits are used up for this account.',
  [SmartSpectraErrorCode.kNetworkError]: 'Cannot reach Presage to validate the API key.',
  [SmartSpectraErrorCode.kServerError]: 'Presage server error.',
  [SmartSpectraErrorCode.kInputUnavailable]: 'The camera is unavailable or in use by another app.',
  [SmartSpectraErrorCode.kProcessingFailed]: 'Presage processing could not start.',
};

const nameOf = (table: Record<string, number>, code: number): string =>
  Object.keys(table).find((k) => table[k] === code) ?? String(code);

const tsNumber = (ts: unknown): number =>
  typeof ts === 'number' ? ts : Number((ts as { toNumber?: () => number })?.toNumber?.() ?? 0);

/**
 * BiometricProvider backed by the SmartSpectra renderer SDK. The SDK opens the camera itself
 * (getUserMedia) and ships frames to the main-process native SDK; processing is on-device.
 * Requests only PULSE_RATE.
 */
export class PresageProvider implements BiometricProvider {
  private sdk: { instance: SmartSpectraSDK; started: Promise<void> } | null = null;
  /**
   * The SDK's preload bridge is one shared port: a session torn down after the next one was
   * created would close the new session's port. Teardowns are chained here and start() waits.
   */
  private teardown: Promise<void> = Promise.resolve();
  /** Bumped by stop(); work and callbacks from an older start() are ignored. */
  private generation = 0;

  constructor(private readonly snapshot: () => AppSnapshot | null) {}

  async start(handlers: ProviderHandlers): Promise<void> {
    await this.stop();
    const generation = this.generation;
    const current = (): boolean => generation === this.generation;
    const trace = (m: string): void => {
      if (current()) handlers.trace?.(m);
    };
    let failed = false;
    const unavailable = (reason: string): void => {
      if (!current() || failed) return;
      failed = true;
      trace(`unavailable: ${reason}`);
      handlers.state({ kind: 'unavailable', reason });
      // Nothing more will be measured, so release the camera.
      void this.stop();
    };
    handlers.state({ kind: 'starting' });

    const presage = this.snapshot()?.presage;
    if (!presage?.sdkLoaded) return unavailable(presage?.sdkError ?? 'Presage SDK not loaded.');
    const config = await zz().getPresageConfig();
    if (!current()) return;
    if (!config) return unavailable('No Presage API key configured.');
    const cameraOk = await zz().requestCamera();
    if (!current()) return;
    trace(`OS camera access: ${cameraOk ? 'granted' : 'denied'}`);
    if (!cameraOk) {
      return unavailable(
        'Camera access is off. Allow it in System Settings > Privacy & Security > Camera.',
      );
    }

    let sdk: SmartSpectraSDK;
    try {
      sdk = new SmartSpectraSDK({
        apiKey: config.apiKey,
        requestedMetrics: [MetricType.PULSE_RATE],
        enableTelemetry: config.enableTelemetry,
        enableAccumulatedOutput: false,
      });
    } catch (err) {
      return unavailable(`Presage SDK could not start (${String(err)}).`);
    }

    let validationOk = false;
    let lastValidation = -1;
    let lastTs = 0;
    sdk.on('processingStatus', (status) => trace(`status ${nameOf(ProcessingStatus, status)}`));
    sdk.on('validationStatus', (code, _ts, sdkHint) => {
      if (!current()) return;
      validationOk = code === ValidationCode.kOk;
      if (code !== lastValidation) {
        lastValidation = code;
        trace(`validation ${nameOf(ValidationCode, code)}${sdkHint ? `: ${sdkHint}` : ''}`);
      }
      const hint = validationOk ? null : (HINTS[code] ?? (sdkHint || null));
      handlers.state({ kind: 'measuring', ok: validationOk, hint });
    });
    sdk.on('metrics', (buf) => {
      if (!current()) return;
      let pulse;
      try {
        pulse = decodeMetrics(buf).cardio?.pulseRate ?? [];
      } catch (err) {
        zz().log('warn', `metrics decode failed: ${String(err)}`);
        return;
      }
      for (const m of pulse) {
        const ts = tsNumber(m.timestamp);
        if (typeof m.value !== 'number' || (ts && ts <= lastTs)) continue;
        lastTs = ts;
        handlers.reading({
          bpm: m.value,
          stable: m.stable === true && validationOk,
          confidence: typeof m.confidence === 'number' ? m.confidence : undefined,
          measuredAt: ts ? ts / 1000 : undefined,
        });
      }
    });
    sdk.on('error', (code, message, retryable) => {
      zz().log('warn', `SmartSpectra error ${code} (retryable=${retryable}): ${message}`);
      trace(`error ${nameOf(SmartSpectraErrorCode, code)} (retryable=${retryable}): ${message}`);
      unavailable(ERRORS[code] ?? `Presage SDK error (${nameOf(SmartSpectraErrorCode, code)}).`);
    });
    sdk.on('streamAvailable', (stream) => {
      if (current()) handlers.stream?.(stream);
    });

    trace('starting SDK session');
    const started = sdk.start();
    this.sdk = { instance: sdk, started };
    try {
      await started;
      trace('SDK session running');
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      zz().log('warn', `SmartSpectra start failed: ${String(err)}`);
      unavailable(
        (typeof code === 'number' && ERRORS[code]) ||
          `Could not start the camera measurement (${err instanceof Error ? err.message : String(err)}).`,
      );
    }
  }

  stop(): Promise<void> {
    this.generation++;
    const sdk = this.sdk;
    this.sdk = null;
    if (sdk) this.teardown = this.teardown.then(() => release(sdk));
    return this.teardown;
  }
}

/** Never rejects. Waits for start() to settle so a pending getUserMedia can't reopen the camera. */
async function release(sdk: { instance: SmartSpectraSDK; started: Promise<void> }): Promise<void> {
  await sdk.started.catch(() => undefined);
  try {
    await sdk.instance.stop();
  } catch {
    // already stopped or never started
  }
  try {
    sdk.instance.destroy();
  } catch {
    // already destroyed
  }
}
