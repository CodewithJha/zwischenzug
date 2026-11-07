import { app, safeStorage } from 'electron';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const keyFile = (): string => path.join(app.getPath('userData'), 'presage-key.bin');

/** Decrypted saved key, cached so snapshots (every second in a cooldown) don't hit the keychain. */
let saved: string | null | undefined;

function readSaved(): string | null {
  if (saved !== undefined) return saved;
  try {
    saved = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(readFileSync(keyFile())) || null
      : null;
  } catch {
    saved = null;
  }
  return saved;
}

/** Where the key comes from; the key itself is never shown. */
export function presageKeySource(): 'env' | 'saved' | null {
  if (process.env.PRESAGE_API_KEY?.trim()) return 'env';
  return readSaved() ? 'saved' : null;
}

/**
 * Presage API key lookup: `PRESAGE_API_KEY` env var first, then the key saved from the
 * app, encrypted with the OS keychain via safeStorage. Never stored in plain text by us.
 */
export function getPresageKey(): string | null {
  return process.env.PRESAGE_API_KEY?.trim() || readSaved();
}

export function savePresageKey(key: string): void {
  const trimmed = key.trim();
  if (!trimmed) {
    rmSync(keyFile(), { force: true });
    saved = null;
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS secure storage is unavailable; set PRESAGE_API_KEY instead');
  }
  writeFileSync(keyFile(), safeStorage.encryptString(trimmed), { mode: 0o600 });
  saved = trimmed;
}
