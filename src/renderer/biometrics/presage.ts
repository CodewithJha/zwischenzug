import {
  MetricType,
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
};

const tsNumber = (ts: unknown): number =>
  typeof ts === 'number' ? ts : Number((ts as { toNumber?: () => number })?.toNumber?.() ?? 0);

/**
 * BiometricProvider backed by the SmartSpectra renderer SDK. The SDK opens the camera itself
 * (getUserMedia) and ships frames to the main-process native SDK; processing is on-device.
 * Requests only PULSE_RATE.
 */
export class PresageProvider implements BiometricProvider {
  private sdk: SmartSpectraSDK | null = null;
  private lastTs = 0;
  /** Bumped by stop(); a start() that awaited across a stop() must not open the camera. */
  private generation = 0;

  constructor(private readonly snapshot: () => AppSnapshot | null) {}

  async start(handlers: ProviderHandlers): Promise<void> {
    await this.stop();
    const generation = this.generation;
    const unavailable = (reason: string): void => handlers.state({ kind: 'unavailable', reason });
    handlers.state({ kind: 'starting' });

    const presage = this.snapshot()?.presage;
    if (!presage?.sdkLoaded) return unavailable(presage?.sdkError ?? 'Presage SDK not loaded.');
    const config = await zz().getPresageConfig();
    if (!config) return unavailable('No Presage API key configured.');
    const cameraOk = await zz().requestCamera();
    if (generation !== this.generation) return;
    if (!cameraOk) {
      return unavailable(
        'Camera access is off. Allow it in System Settings > Privacy & Security > Camera.',
      );
    }

    let validationOk = false;
    const sdk = new SmartSpectraSDK({
      apiKey: config.apiKey,
      requestedMetrics: [MetricType.PULSE_RATE],
      enableTelemetry: config.enableTelemetry,
      enableAccumulatedOutput: false,
    });
    this.sdk = sdk;
    sdk.on('validationStatus', (code) => {
      validationOk = code === ValidationCode.kOk;
      handlers.state({ kind: 'measuring', ok: validationOk, hint: HINTS[code] ?? null });
    });
    sdk.on('metrics', (buf) => {
      let pulse;
      try {
        pulse = decodeMetrics(buf).cardio?.pulseRate ?? [];
      } catch (err) {
        zz().log('warn', `metrics decode failed: ${String(err)}`);
        return;
      }
      for (const m of pulse) {
        const ts = tsNumber(m.timestamp);
        if (typeof m.value !== 'number' || (ts && ts <= this.lastTs)) continue;
        this.lastTs = ts;
        handlers.reading({ bpm: m.value, stable: m.stable === true && validationOk });
      }
    });
    sdk.on('error', (code, message) => {
      zz().log('warn', `SmartSpectra error ${code}: ${message}`);
      unavailable(ERRORS[code] ?? `Presage SDK error (${code}).`);
    });
    sdk.on('streamAvailable', (stream) => handlers.stream?.(stream));

    try {
      await sdk.start();
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      zz().log('warn', `SmartSpectra start failed: ${String(err)}`);
      unavailable(
        (typeof code === 'number' && ERRORS[code]) ||
          `Could not start the camera measurement (${err instanceof Error ? err.message : String(err)}).`,
      );
      await this.stop();
    }
  }

  async stop(): Promise<void> {
    this.generation++;
    const sdk = this.sdk;
    this.sdk = null;
    this.lastTs = 0;
    if (!sdk) return;
    try {
      await sdk.stop();
    } catch {
      // already stopped or never started
    }
    try {
      sdk.destroy();
    } catch {
      // already destroyed
    }
  }
}
