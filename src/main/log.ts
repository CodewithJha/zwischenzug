import log from 'electron-log/main';
import path from 'node:path';

// Logs go to the OS log dir (macOS: ~/Library/Logs/Zwischenzug/main.log), or to
// <ZZ_USER_DATA_DIR>/logs when a separate data folder is used.
// Never log pulse values or API keys here: logs are diagnostics, not a data store.
const dataDir = process.env.ZZ_USER_DATA_DIR;
if (dataDir) log.transports.file.resolvePathFn = () => path.join(dataDir, 'logs', 'main.log');
log.transports.file.level = 'info';
log.transports.console.level = process.env.ZZ_LOG_LEVEL === 'debug' ? 'debug' : 'info';

export const logger = log.scope('zz');

/** Folder of the diagnostic log files. */
export const logDir = (): string => path.dirname(log.transports.file.getFile().path);
