interface QuittableApp {
  on(event: 'before-quit', listener: (event: { preventDefault(): void }) => void): unknown;
  quit(): void;
}

/**
 * Holds the first quit until `drain` settles or `timeoutMs` passes, then quits for real.
 * Repeated quit requests while draining are absorbed.
 */
export function quitAfter(app: QuittableApp, drain: () => Promise<void>, timeoutMs: number): void {
  let state: 'idle' | 'draining' | 'done' = 'idle';
  app.on('before-quit', (event) => {
    if (state === 'done') return;
    event.preventDefault();
    if (state === 'draining') return;
    state = 'draining';
    const timeout = new Promise<void>((r) => setTimeout(r, timeoutMs));
    void Promise.race([drain().catch(() => undefined), timeout]).then(() => {
      state = 'done';
      app.quit();
    });
  });
}
