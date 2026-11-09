import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderState } from '../../src/renderer/biometrics/provider';

// Test fake of the renderer SDK: records lifecycle calls in order.
const calls: string[] = [];
let instances = 0;
let releaseStop: (() => void) | null = null;

vi.mock('@smartspectra/node-sdk/renderer', () => {
  class SmartSpectraSDK {
    private readonly id = ++instances;
    private readonly listeners = new Map<string, (...a: unknown[]) => void>();
    constructor() {
      calls.push(`new ${this.id}`);
    }
    on(event: string, cb: (...a: unknown[]) => void): this {
      this.listeners.set(event, cb);
      return this;
    }
    emit(event: string, ...args: unknown[]): void {
      this.listeners.get(event)?.(...args);
    }
    async start(): Promise<void> {
      calls.push(`start ${this.id}`);
      fakes.push(this);
    }
    stop(): Promise<void> {
      calls.push(`stop ${this.id}`);
      return new Promise((r) => (releaseStop = r));
    }
    destroy(): void {
      calls.push(`destroy ${this.id}`);
    }
  }
  return {
    SmartSpectraSDK,
    MetricType: { PULSE_RATE: 15 },
    ProcessingStatus: { kRunning: 3 },
    ValidationCode: { kOk: 0, kNoFaceFound: 1 },
    SmartSpectraErrorCode: { kAuthenticationFailed: 2, kProcessingFailed: 8 },
  };
});
vi.mock('@smartspectra/node-sdk/messages', () => ({ decodeMetrics: () => ({}) }));

const fakes: { emit(event: string, ...args: unknown[]): void }[] = [];

const { PresageProvider } = await import('../../src/renderer/biometrics/presage');

const snapshot = { presage: { sdkLoaded: true, sdkError: null, apiKeyConfigured: true } };
const handlers = (states: ProviderState[] = []) => ({
  reading: vi.fn(),
  state: (s: ProviderState) => states.push(s),
});
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  calls.length = 0;
  fakes.length = 0;
  instances = 0;
  releaseStop = null;
  (globalThis as { window?: unknown }).window = {
    zz: {
      getPresageConfig: async () => ({ apiKey: 'k', enableTelemetry: false }),
      requestCamera: async () => true,
      log: () => undefined,
    },
  };
});

describe('PresageProvider', () => {
  it('does not create the next session until the previous one is destroyed', async () => {
    const provider = new PresageProvider(() => snapshot as never);
    await provider.start(handlers());
    // Screen change: the old view stops (not awaited) and the new view starts at once.
    void provider.stop();
    const second = provider.start(handlers());
    await flush();
    expect(calls).toEqual(['new 1', 'start 1', 'stop 1']);
    releaseStop?.();
    await second;
    expect(calls).toEqual(['new 1', 'start 1', 'stop 1', 'destroy 1', 'new 2', 'start 2']);
  });

  it('releases the camera on an SDK error and ignores the old session afterwards', async () => {
    const provider = new PresageProvider(() => snapshot as never);
    const states: ProviderState[] = [];
    const h = handlers(states);
    await provider.start(h);
    fakes[0]?.emit('error', 2, 'bad key', false);
    await flush();
    expect(states.at(-1)).toEqual({ kind: 'unavailable', reason: 'Presage rejected the API key.' });
    expect(calls).toContain('stop 1');
    fakes[0]?.emit('validationStatus', 0, 0, '');
    expect(states.at(-1)?.kind).toBe('unavailable');
  });

  it('a processing failure with no face in view says so and is retryable', async () => {
    const provider = new PresageProvider(() => snapshot as never);
    const states: ProviderState[] = [];
    await provider.start(handlers(states));
    fakes[0]?.emit('validationStatus', 1, 0, '');
    fakes[0]?.emit('error', 8, 'watchdog', true);
    await flush();
    const last = states.at(-1);
    expect(last).toMatchObject({ kind: 'unavailable', retryable: true });
    expect(last?.kind === 'unavailable' && last.reason).toMatch(/no face/i);
    expect(last?.kind === 'unavailable' && last.reason).not.toMatch(/could not start/i);
  });
});
