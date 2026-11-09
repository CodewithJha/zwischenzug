import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';
import { logger } from './log';

export interface JsonFileOptions<T> {
  /** Also keep the latest value in `<file>.bak`, used when the main file is damaged. */
  backup?: boolean;
  /** Value when the file is damaged and no valid backup exists (default: `fallback`). */
  corrupt?: () => T;
}

/**
 * One JSON file with a validating reader. Writes are atomic (temp file + rename) and
 * fsynced, so a crash mid-write never leaves a half-written lock state behind.
 */
export class JsonFile<T> {
  private readonly backupFile: string | null;

  constructor(
    private readonly file: string,
    private readonly parse: (raw: unknown) => T | null,
    private readonly fallback: () => T,
    private readonly options: JsonFileOptions<T> = {},
  ) {
    this.backupFile = options.backup ? `${file}.bak` : null;
  }

  read(): T {
    const main = this.load(this.file);
    if (main.value !== null) return main.value;
    // Keep an unreadable file for inspection instead of silently discarding it.
    if (main.exists) renameSync(this.file, `${this.file}.corrupt-${Date.now()}`);
    const backup = this.backupFile ? this.load(this.backupFile) : { exists: false, value: null };
    if (backup.value !== null) {
      logger.warn(`${path.basename(this.file)} unreadable or missing; restored from backup`);
      return backup.value;
    }
    if (!main.exists && !backup.exists) return this.fallback();
    logger.warn(`unreadable ${path.basename(this.file)} and no valid backup`);
    return (this.options.corrupt ?? this.fallback)();
  }

  private load(file: string): { exists: boolean; value: T | null } {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch (err) {
      return { exists: (err as NodeJS.ErrnoException).code !== 'ENOENT', value: null };
    }
    try {
      return { exists: true, value: this.parse(JSON.parse(text)) };
    } catch {
      return { exists: true, value: null };
    }
  }

  write(value: T): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const text = JSON.stringify(value, null, 2);
    writeDurably(this.file, text);
    if (this.backupFile) writeDurably(this.backupFile, text);
  }

  delete(): void {
    rmSync(this.file, { force: true });
    if (this.backupFile) rmSync(this.backupFile, { force: true });
  }
}

function writeDurably(file: string, text: string): void {
  const tmp = `${file}.tmp`;
  const fd = openSync(tmp, 'w', 0o600);
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, file);
  // Persist the rename itself; directories cannot be opened for fsync on every platform.
  try {
    const dirFd = openSync(path.dirname(file), 'r');
    try {
      fsyncSync(dirFd);
    } finally {
      closeSync(dirFd);
    }
  } catch {
    // best effort
  }
}
