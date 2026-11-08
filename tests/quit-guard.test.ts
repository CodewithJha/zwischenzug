import { describe, expect, it, vi } from 'vitest';
import { quitAfter } from '../src/core/quit-guard';

function fakeApp() {
  let listener: (e: { preventDefault(): void }) => void = () => undefined;
  const app = {
    quits: 0,
    on: (_: 'before-quit', l: typeof listener) => (listener = l),
    quit: () => {
      app.quits++;
      app.request();
    },
    /** Emits before-quit; true if the quit went ahead. */
    request: (): boolean => {
      let prevented = false;
      listener({ preventDefault: () => (prevented = true) });
      return !prevented;
    },
  };
  return app;
}

describe('quitAfter', () => {
  it('holds the quit until the drain settles, then quits once', async () => {
    const app = fakeApp();
    let finish = (): void => undefined;
    const drain = vi.fn(() => new Promise<void>((r) => (finish = r)));
    quitAfter(app, drain, 10_000);

    expect(app.request()).toBe(false);
    expect(app.request()).toBe(false); // a second Cmd+Q while draining
    expect(drain).toHaveBeenCalledTimes(1);
    expect(app.quits).toBe(0);

    finish();
    await vi.waitFor(() => expect(app.quits).toBe(1));
    expect(app.request()).toBe(true);
  });

  it('quits anyway when the drain fails or hangs', async () => {
    vi.useFakeTimers();
    try {
      const failing = fakeApp();
      quitAfter(failing, () => Promise.reject(new Error('boom')), 10_000);
      failing.request();
      await vi.waitFor(() => expect(failing.quits).toBe(1));

      const hanging = fakeApp();
      quitAfter(hanging, () => new Promise<void>(() => undefined), 10_000);
      hanging.request();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(hanging.quits).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
