import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { logger } from './log';

/**
 * One JSON file with a validating reader. Writes are atomic (temp file + rename) so a
 * crash mid-write never leaves a half-written lock state behind.
 */
export class JsonFile<T> {
  constructor(
    private readonly file: string,
    private readonly parse: (raw: unknown) => T | null,
    private readonly fallback: () => T,
  ) {}

  read(): T {
    let text: string;
    try {
      text = readFileSync(this.file, 'utf8');
    } catch {
      return this.fallback();
    }
    try {
      const value = this.parse(JSON.parse(text));
      if (value !== null) return value;
    } catch {
      // fall through
    }
    // Keep the unreadable file for inspection instead of silently discarding it.
    logger.warn(`unreadable ${path.basename(this.file)}; starting fresh`);
    renameSync(this.file, `${this.file}.corrupt-${Date.now()}`);
    return this.fallback();
  }

  write(value: T): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  delete(): void {
    rmSync(this.file, { force: true });
  }
}
