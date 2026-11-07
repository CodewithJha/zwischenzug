import log from 'electron-log/main';

// Logs go to the OS log dir (macOS: ~/Library/Logs/Zwischenzug/main.log).
// Never log pulse values or API keys here: logs are diagnostics, not a data store.
log.transports.file.level = 'info';
log.transports.console.level = process.env.ZZ_LOG_LEVEL === 'debug' ? 'debug' : 'info';

export const logger = log.scope('zz');
