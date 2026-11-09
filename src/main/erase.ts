import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

/** Files besides state.json (which delete-all rewrites fresh) that the app writes. */
const DATA_FILES = /^(?:games\.json|presage-key\.bin|.+\.corrupt-\d+|.+\.tmp)$/;

/**
 * Delete-all, file part: the game log, quarantined damaged copies, temp files, the saved
 * Presage key and the diagnostic log files. The user-authored config file is kept.
 */
export function eraseLocalFiles(dataDir: string, logDir: string | null): void {
  const targets: [string | null, RegExp][] = [
    [dataDir, DATA_FILES],
    [logDir, /\.log$/],
  ];
  for (const [dir, pattern] of targets) {
    if (!dir) continue;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (pattern.test(name)) rmSync(path.join(dir, name), { force: true });
    }
  }
}
