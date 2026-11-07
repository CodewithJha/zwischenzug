import { app, safeStorage } from 'electron';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const keyFile = (): string => path.join(app.getPath('userData'), 'presage-key.bin');

/**
 * Presage API key lookup: `PRESAGE_API_KEY` env var first, then the key saved from the
 * app, encrypted with the OS keychain via safeStorage. Never stored in plain text by us.
 */
export function getPresageKey(): string | null {
  const fromEnv = process.env.PRESAGE_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(readFileSync(keyFile())) || null;
  } catch {
    return null;
  }
}

export function savePresageKey(key: string): void {
  const trimmed = key.trim();
  if (!trimmed) {
    rmSync(keyFile(), { force: true });
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS secure storage is unavailable; set PRESAGE_API_KEY instead');
  }
  writeFileSync(keyFile(), safeStorage.encryptString(trimmed), { mode: 0o600 });
}
