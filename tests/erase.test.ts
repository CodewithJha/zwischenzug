import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { eraseLocalFiles } from '../src/main/erase';

let root: string;
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('eraseLocalFiles (delete-all)', () => {
  it('removes the game log, quarantined copies, temp files, saved key and logs', () => {
    root = mkdtempSync(path.join(tmpdir(), 'zz-erase-'));
    const data = path.join(root, 'data');
    const logs = path.join(root, 'logs');
    mkdirSync(data);
    mkdirSync(logs);
    const files = [
      'games.json',
      'games.json.corrupt-1700000000000',
      'state.json.corrupt-1700000000001',
      'state.json.tmp',
      'presage-key.bin',
      'state.json',
      'state.json.bak',
      'zwischenzug.config.json',
    ];
    for (const f of files) writeFileSync(path.join(data, f), 'x');
    for (const f of ['main.log', 'main.old.log']) writeFileSync(path.join(logs, f), 'x');

    eraseLocalFiles(data, logs);

    // state.json and its backup are rewritten fresh by delete-all; the config file is the user's.
    expect(readdirSync(data).sort()).toEqual([
      'state.json',
      'state.json.bak',
      'zwischenzug.config.json',
    ]);
    expect(readdirSync(logs)).toEqual([]);
  });

  it('tolerates missing folders', () => {
    root = mkdtempSync(path.join(tmpdir(), 'zz-erase-'));
    expect(() => eraseLocalFiles(path.join(root, 'nope'), null)).not.toThrow();
  });
});
