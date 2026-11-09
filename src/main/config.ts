import { app } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveConfig, type Config } from '../core/config';
import { logger } from './log';

/**
 * Config sources, lowest to highest precedence: built-in defaults, the optional
 * `<userData>/zwischenzug.config.json`, then environment variables (a `.env` in the
 * working directory is loaded in development only; packaged builds ignore the timing
 * and threshold variables).
 */
export function loadConfig(): Config {
  if (!app.isPackaged && existsSync('.env')) process.loadEnvFile('.env');

  const file = path.join(app.getPath('userData'), 'zwischenzug.config.json');
  let fileJson: unknown = undefined;
  if (existsSync(file)) {
    try {
      fileJson = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      logger.warn(`ignoring unreadable config file: ${String(err)}`);
    }
  }
  const { config, warnings } = resolveConfig(fileJson, process.env, { packaged: app.isPackaged });
  for (const w of warnings) logger.warn(`config: ${w}`);
  return config;
}
